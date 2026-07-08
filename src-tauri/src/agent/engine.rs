//! LabNexus — Agent ReAct Engine.
//!
//! Manages conversation sessions, executes the asynchronous ReAct loop,
//! invokes MCP tools, and streams thoughts and observations to Tauri IPC.

use crate::agent::config::load_ai_config;
use crate::agent::llm::LlmClient;
use crate::agent::mcp::ToolRegistry;
use crate::agent::types::*;
use crate::error::AppError;
use crate::state::AppState;
use std::collections::HashMap;
use std::sync::Arc;
use tauri::{AppHandle, Emitter};
use tokio::sync::{oneshot, RwLock};

pub struct AgentSession {
    pub id: String,
    pub history: Vec<AgentMessage>,
    pub context: AgentChatContext,
}

pub struct AgentEngine {
    pub sessions: Arc<RwLock<HashMap<String, AgentSession>>>,
    pub llm: LlmClient,
    pub tools: ToolRegistry,
    /// Pending tool confirmations: session_id -> (tool_call_id, oneshot::Sender<bool>)
    pub pending_confirmations: Arc<RwLock<HashMap<String, (String, oneshot::Sender<bool>)>>>,
}

impl Default for AgentEngine {
    fn default() -> Self {
        Self::new()
    }
}

impl AgentEngine {
    pub fn new() -> Self {
        Self {
            sessions: Arc::new(RwLock::new(HashMap::new())),
            llm: LlmClient::new(),
            tools: ToolRegistry::new(),
            pending_confirmations: Arc::new(RwLock::new(HashMap::new())),
        }
    }

    /// Retrieve conversation history for a session.
    pub async fn get_history(&self, session_id: &str) -> Vec<AgentMessage> {
        let sessions = self.sessions.read().await;
        sessions
            .get(session_id)
            .map(|s| s.history.clone())
            .unwrap_or_default()
    }

    /// Clear conversation history for a session.
    pub async fn clear_session(&self, session_id: &str) {
        let mut sessions = self.sessions.write().await;
        sessions.remove(session_id);
    }

    /// Confirm or deny a pending tool call.
    pub async fn confirm_tool(
        &self,
        session_id: &str,
        tool_call_id: &str,
        approved: bool,
    ) -> Result<(), AppError> {
        let mut pending = self.pending_confirmations.write().await;
        if let Some((expected_id, tx)) = pending.remove(session_id) {
            if expected_id == tool_call_id {
                let _ = tx.send(approved);
                return Ok(());
            }
        }
        Err(AppError::Agent(
            "No matching pending tool confirmation found.".to_string(),
        ))
    }

    /// Run the ReAct agent loop for a user prompt.
    pub async fn run_task(
        &self,
        session_id: &str,
        user_prompt: &str,
        context: Option<AgentChatContext>,
        state: &AppState,
        app: AppHandle,
    ) -> Result<(), AppError> {
        if let Err(e) = self
            .run_task_inner(session_id, user_prompt, context, state, app.clone())
            .await
        {
            let _ = app.emit(
                "agent:stream",
                AgentStreamEvent {
                    session_id: session_id.to_string(),
                    chunk_type: "error".to_string(),
                    content: e.to_string(),
                },
            );
            return Err(e);
        }
        Ok(())
    }

    async fn run_task_inner(
        &self,
        session_id: &str,
        user_prompt: &str,
        context: Option<AgentChatContext>,
        state: &AppState,
        app: AppHandle,
    ) -> Result<(), AppError> {
        let start_instant = std::time::Instant::now();
        let start_time_str = chrono::Utc::now().to_rfc3339();
        let mut trace_steps = Vec::new();
        let mut step_idx = 0;

        let sys_prompt = "You are LabNexus Assistant, an intelligent scientific computing agent powered by ReAct and Jupyter MCP tools.\n\
You can analyze data, write Python scripts, execute code in Jupyter kernels, inspect files, and manage notebooks.\n\
When executing Python code or modifying notebooks, explain your reasoning clearly before calling tools.\n\
If a tool execution fails, analyze the traceback and try to fix the code automatically.".to_string();

        let mut enhanced_prompt = user_prompt.to_string();
        if let Some(ctx) = &context {
            let mut ctx_str = "\n\n[Active Workspace Context]\n".to_string();
            if let Some(path) = &ctx.notebook_path {
                ctx_str.push_str(&format!("- Notebook Path: {}\n", path));
            }
            if let Some(idx) = ctx.active_cell_index {
                ctx_str.push_str(&format!("- Active Cell Index: {}\n", idx));
            }
            if let Some(code) = &ctx.active_cell_code {
                ctx_str.push_str(&format!("- Active Cell Code:\n```python\n{}\n```\n", code));
            }
            if let Some(status) = &ctx.kernel_status {
                ctx_str.push_str(&format!("- Kernel Status: {}\n", status));
            }
            if let Some(err) = &ctx.last_error {
                ctx_str.push_str(&format!("- Recent Error Log:\n```\n{}\n```\n", err));
            }
            if ctx_str.len() > 30 {
                enhanced_prompt.push_str(&ctx_str);
            }
        }

        // 1. Check Skill matching
        let matched_skill_opt = state.skills.match_query(user_prompt);
        let mut matched_skill_id = None;
        if let Some(skill) = &matched_skill_opt {
            matched_skill_id = Some(skill.id.clone());
            let skill_prompt = state.skills.format_skill_prompt(skill);
            enhanced_prompt.push_str("\n\n");
            enhanced_prompt.push_str(&skill_prompt);

            let _ = app.emit(
                "agent:stream",
                AgentStreamEvent {
                    session_id: session_id.to_string(),
                    chunk_type: "answer".to_string(),
                    content: format!(
                        "> **⚡ Activated Workflow Skill**: `{}` ({})\n\n",
                        skill.name, skill.id
                    ),
                },
            );
        }

        // 2. Check Knowledge retrieval
        let mut used_knowledge_ids = Vec::new();
        if let Ok(k_store) = state.get_knowledge_store().await {
            let retrieval = crate::agent::KnowledgeRetrieval::new(k_store);
            if let Ok(entries) = retrieval.retrieve(user_prompt).await {
                if !entries.is_empty() {
                    for e in &entries {
                        used_knowledge_ids.push(e.id.clone());
                    }
                    let k_prompt = retrieval.format_knowledge_prompt(&entries);
                    enhanced_prompt.push_str("\n\n");
                    enhanced_prompt.push_str(&k_prompt);
                }
            }
        }

        // Initialize or update session history
        {
            let mut sessions = self.sessions.write().await;
            let sess = sessions
                .entry(session_id.to_string())
                .or_insert_with(|| AgentSession {
                    id: session_id.to_string(),
                    history: vec![AgentMessage::system(sys_prompt)],
                    context: context.clone().unwrap_or_default(),
                });
            sess.history.push(AgentMessage::user(&enhanced_prompt));
        }

        let config = load_ai_config();
        let tools_def = self.tools.get_definitions();
        let mut turns = 0;
        const MAX_TURNS: usize = 10;

        while turns < MAX_TURNS {
            turns += 1;
            let messages = {
                let sessions = self.sessions.read().await;
                sessions
                    .get(session_id)
                    .map(|s| s.history.clone())
                    .unwrap_or_default()
            };

            let sid_clone = session_id.to_string();
            let app_clone = app.clone();

            // Stream response from LLM
            let assistant_msg = self
                .llm
                .stream_chat(&config, &messages, &tools_def, move |chunk| {
                    let _ = app_clone.emit(
                        "agent:stream",
                        AgentStreamEvent {
                            session_id: sid_clone.clone(),
                            chunk_type: "answer".to_string(),
                            content: chunk.to_string(),
                        },
                    );
                })
                .await?;

            step_idx += 1;
            trace_steps.push(crate::agent::TraceStep {
                step_number: step_idx,
                step_type: "Thought/Answer".to_string(),
                content: assistant_msg.content.clone(),
                tool_name: None,
                duration_ms: start_instant.elapsed().as_millis() as u64,
                timestamp: chrono::Utc::now().to_rfc3339(),
            });

            // Append assistant message to history
            {
                let mut sessions = self.sessions.write().await;
                if let Some(sess) = sessions.get_mut(session_id) {
                    sess.history.push(assistant_msg.clone());
                }
            }

            // Check if there are tool calls
            if let Some(tool_calls) = &assistant_msg.tool_calls {
                if tool_calls.is_empty() {
                    break;
                }

                for tc in tool_calls {
                    let tool_name = &tc.function.name;
                    let args_str = &tc.function.arguments;
                    let args_val: serde_json::Value =
                        serde_json::from_str(args_str).unwrap_or(serde_json::json!({}));

                    // Check if confirmation is required
                    let requires_conf = self.tools.requires_confirmation(tool_name);
                    if requires_conf {
                        let _ = app.emit(
                            "agent:tool_call",
                            AgentToolCallEvent {
                                session_id: session_id.to_string(),
                                tool_call_id: tc.id.clone(),
                                tool_name: tool_name.clone(),
                                arguments: args_val.clone(),
                                status: "requires_confirmation".to_string(),
                                result: None,
                            },
                        );

                        let (tx, rx) = oneshot::channel::<bool>();
                        {
                            let mut pending = self.pending_confirmations.write().await;
                            pending.insert(session_id.to_string(), (tc.id.clone(), tx));
                        }

                        let approved = rx.await.unwrap_or(false);
                        {
                            let mut pending = self.pending_confirmations.write().await;
                            pending.remove(session_id);
                        }

                        if !approved {
                            let deny_msg = "User denied execution of this tool.";
                            let _ = app.emit(
                                "agent:tool_call",
                                AgentToolCallEvent {
                                    session_id: session_id.to_string(),
                                    tool_call_id: tc.id.clone(),
                                    tool_name: tool_name.clone(),
                                    arguments: args_val.clone(),
                                    status: "error".to_string(),
                                    result: Some(deny_msg.to_string()),
                                },
                            );

                            let mut sessions = self.sessions.write().await;
                            if let Some(sess) = sessions.get_mut(session_id) {
                                sess.history
                                    .push(AgentMessage::tool_result(&tc.id, tool_name, deny_msg));
                            }
                            continue;
                        }
                    }

                    // Emit running status
                    let _ = app.emit(
                        "agent:tool_call",
                        AgentToolCallEvent {
                            session_id: session_id.to_string(),
                            tool_call_id: tc.id.clone(),
                            tool_name: tool_name.clone(),
                            arguments: args_val.clone(),
                            status: "running".to_string(),
                            result: None,
                        },
                    );

                    // Execute tool
                    let res = self.tools.execute(tool_name, &args_val, state, &app).await;
                    let (status_str, output_str) = match res {
                        Ok(out) => ("completed".to_string(), out),
                        Err(e) => ("error".to_string(), e.to_string()),
                    };

                    let _ = app.emit(
                        "agent:tool_call",
                        AgentToolCallEvent {
                            session_id: session_id.to_string(),
                            tool_call_id: tc.id.clone(),
                            tool_name: tool_name.clone(),
                            arguments: args_val.clone(),
                            status: status_str,
                            result: Some(output_str.clone()),
                        },
                    );

                    step_idx += 1;
                    trace_steps.push(crate::agent::TraceStep {
                        step_number: step_idx,
                        step_type: "ToolCall".to_string(),
                        content: format!("Args: {} -> Result: {}", args_val, output_str),
                        tool_name: Some(tool_name.clone()),
                        duration_ms: start_instant.elapsed().as_millis() as u64,
                        timestamp: chrono::Utc::now().to_rfc3339(),
                    });

                    // Append tool observation to history
                    {
                        let mut sessions = self.sessions.write().await;
                        if let Some(sess) = sessions.get_mut(session_id) {
                            sess.history.push(AgentMessage::tool_result(
                                &tc.id,
                                tool_name,
                                &output_str,
                            ));
                        }
                    }
                }
            } else {
                // No tool calls requested, turn complete!
                break;
            }
        }

        if let Ok(t_store) = state.get_trace_store().await {
            let trace = crate::agent::AgentTrace {
                id: uuid::Uuid::new_v4().to_string(),
                task_prompt: user_prompt.to_string(),
                status: "Completed".to_string(),
                start_time: start_time_str,
                end_time: Some(chrono::Utc::now().to_rfc3339()),
                total_duration_ms: start_instant.elapsed().as_millis() as u64,
                steps: trace_steps,
                matched_skill: matched_skill_id,
                used_knowledge_ids,
            };
            let _ = t_store.save_trace(&trace).await;
        }

        let _ = app.emit(
            "agent:stream",
            AgentStreamEvent {
                session_id: session_id.to_string(),
                chunk_type: "done".to_string(),
                content: "".to_string(),
            },
        );

        Ok(())
    }
}
