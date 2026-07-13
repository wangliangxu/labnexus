//! LabNexus — Tauri IPC commands for AI Agent.

use crate::agent::mcp::{
    load_external_mcp_config, save_external_mcp_config, ExternalMcpConfigFile,
};
use crate::agent::session::AgentSessionListItem;
use crate::agent::{
    load_ai_config, save_ai_config, AgentChatContext, AgentMessage, AgentTrace, AiConfig,
    KnowledgeEntry, Skill,
};
use crate::error::AppError;
use crate::state::AppState;
use tauri::{AppHandle, State};

const REDACTED_API_KEY: &str = "••••••••";

/// Start or continue an agent chat/task in the ReAct loop.
#[tauri::command]
pub async fn agent_run_task(
    state: State<'_, AppState>,
    app: AppHandle,
    session_id: String,
    run_id: String,
    prompt: String,
    context: Option<AgentChatContext>,
) -> Result<(), AppError> {
    state
        .agent
        .run_task(&session_id, &run_id, &prompt, context, &state, app)
        .await
}

/// Confirm or deny a pending tool call that requires user approval.
#[tauri::command]
pub async fn agent_confirm_tool(
    state: State<'_, AppState>,
    session_id: String,
    run_id: String,
    tool_call_id: String,
    approved: bool,
    approval_scope: Option<String>,
) -> Result<(), AppError> {
    state
        .agent
        .confirm_tool(
            &session_id,
            &run_id,
            &tool_call_id,
            approved,
            approval_scope.as_deref().unwrap_or("once"),
        )
        .await
}

/// Cancel a running Agent task.
#[tauri::command]
pub async fn agent_cancel_task(
    state: State<'_, AppState>,
    session_id: String,
    run_id: Option<String>,
    interrupt_kernel: Option<bool>,
) -> Result<(), AppError> {
    state
        .agent
        .cancel_task(&session_id, run_id.as_deref())
        .await?;
    if interrupt_kernel.unwrap_or(false) {
        if let Some(context) = state.agent.get_context(&session_id).await {
            crate::agent::mcp::jupyter_tools::interrupt_kernel(&context, &state).await?;
        }
    }
    Ok(())
}

/// Complete a notebook mutation requested by an Agent tool.
#[tauri::command]
pub async fn agent_complete_notebook_action(
    state: State<'_, AppState>,
    action_id: String,
    success: bool,
    message: String,
) -> Result<(), AppError> {
    let result = if success { Ok(message) } else { Err(message) };
    state
        .complete_notebook_action(&action_id, result)
        .await
        .map_err(AppError::Agent)
}

/// Retrieve the current AI configuration.
#[tauri::command]
pub async fn agent_get_config() -> Result<AiConfig, AppError> {
    let mut config = load_ai_config();
    if !config.remote.api_key.is_empty() {
        config.remote.api_key = REDACTED_API_KEY.to_string();
    }
    Ok(config)
}

/// Save AI configuration to disk.
#[tauri::command]
pub async fn agent_save_config(mut config: AiConfig) -> Result<(), AppError> {
    if config.remote.api_key == REDACTED_API_KEY {
        config.remote.api_key = load_ai_config().remote.api_key;
    }
    save_ai_config(&config)
}

/// Retrieve external MCP server configuration.
#[tauri::command]
pub async fn agent_get_mcp_config() -> Result<ExternalMcpConfigFile, AppError> {
    let mut config = load_external_mcp_config().map_err(AppError::Agent)?;
    for server in &mut config.servers {
        for value in server.env.values_mut() {
            *value = REDACTED_API_KEY.to_string();
        }
        for value in server.headers.values_mut() {
            *value = REDACTED_API_KEY.to_string();
        }
    }
    Ok(config)
}

/// Save external MCP configuration and immediately refresh available tools.
#[tauri::command]
pub async fn agent_save_mcp_config(
    state: State<'_, AppState>,
    mut config: ExternalMcpConfigFile,
) -> Result<Vec<String>, AppError> {
    let existing = load_external_mcp_config().unwrap_or_default();
    for server in &mut config.servers {
        if let Some(previous) = existing.servers.iter().find(|item| item.id == server.id) {
            for (key, value) in &mut server.env {
                if value == REDACTED_API_KEY {
                    if let Some(previous_value) = previous.env.get(key) {
                        *value = previous_value.clone();
                    }
                }
            }
            for (key, value) in &mut server.headers {
                if value == REDACTED_API_KEY {
                    if let Some(previous_value) = previous.headers.get(key) {
                        *value = previous_value.clone();
                    }
                }
            }
        }
    }
    save_external_mcp_config(&config).map_err(AppError::Agent)?;
    Ok(state.agent.tools.refresh_external_tools().await)
}

#[tauri::command]
pub async fn agent_mcp_capabilities(
    state: State<'_, AppState>,
    server_id: String,
) -> Result<serde_json::Value, AppError> {
    state.agent.tools.refresh_external_tools().await;
    state
        .agent
        .tools
        .external_server_capabilities(&server_id)
        .await
}

#[tauri::command]
pub async fn agent_mcp_list_resources(
    state: State<'_, AppState>,
    server_id: String,
) -> Result<serde_json::Value, AppError> {
    state.agent.tools.refresh_external_tools().await;
    state.agent.tools.list_external_resources(&server_id).await
}

#[tauri::command]
pub async fn agent_mcp_list_resource_templates(
    state: State<'_, AppState>,
    server_id: String,
) -> Result<serde_json::Value, AppError> {
    state.agent.tools.refresh_external_tools().await;
    state
        .agent
        .tools
        .list_external_resource_templates(&server_id)
        .await
}

#[tauri::command]
pub async fn agent_mcp_read_resource(
    state: State<'_, AppState>,
    server_id: String,
    uri: String,
) -> Result<serde_json::Value, AppError> {
    state.agent.tools.refresh_external_tools().await;
    state
        .agent
        .tools
        .read_external_resource(&server_id, &uri)
        .await
}

#[tauri::command]
pub async fn agent_mcp_list_prompts(
    state: State<'_, AppState>,
    server_id: String,
) -> Result<serde_json::Value, AppError> {
    state.agent.tools.refresh_external_tools().await;
    state.agent.tools.list_external_prompts(&server_id).await
}

#[tauri::command]
pub async fn agent_mcp_get_prompt(
    state: State<'_, AppState>,
    server_id: String,
    name: String,
    arguments: serde_json::Value,
) -> Result<serde_json::Value, AppError> {
    state.agent.tools.refresh_external_tools().await;
    state
        .agent
        .tools
        .get_external_prompt(&server_id, &name, arguments)
        .await
}

/// Get conversation history for a session.
#[tauri::command]
pub async fn agent_get_history(
    state: State<'_, AppState>,
    session_id: String,
) -> Result<Vec<AgentMessage>, AppError> {
    state.agent.get_history(&session_id).await
}

/// Clear conversation history for a session.
#[tauri::command]
pub async fn agent_clear_session(
    state: State<'_, AppState>,
    session_id: String,
) -> Result<(), AppError> {
    state.agent.clear_session(&session_id).await
}

#[tauri::command]
pub async fn agent_list_sessions(
    state: State<'_, AppState>,
) -> Result<Vec<AgentSessionListItem>, AppError> {
    state.agent.list_sessions().await
}

#[tauri::command]
pub async fn agent_create_session(
    state: State<'_, AppState>,
    session_id: String,
    title: String,
    context: Option<AgentChatContext>,
) -> Result<(), AppError> {
    state
        .agent
        .create_session(&session_id, &title, context.unwrap_or_default())
        .await
}

#[tauri::command]
pub async fn agent_rename_session(
    state: State<'_, AppState>,
    session_id: String,
    title: String,
) -> Result<(), AppError> {
    state.agent.rename_session(&session_id, &title).await
}

/// List available skills.
#[tauri::command]
pub async fn agent_list_skills(state: State<'_, AppState>) -> Result<Vec<Skill>, AppError> {
    Ok(state.skills.list_skills())
}

/// List domain knowledge base entries.
#[tauri::command]
pub async fn agent_list_knowledge(
    state: State<'_, AppState>,
) -> Result<Vec<KnowledgeEntry>, AppError> {
    let store = state
        .get_knowledge_store()
        .await
        .map_err(|e| AppError::Agent(e))?;
    store.list_entries().await.map_err(|e| AppError::Agent(e))
}

/// Save or update a domain knowledge base entry.
#[tauri::command]
pub async fn agent_save_knowledge(
    state: State<'_, AppState>,
    mut entry: KnowledgeEntry,
) -> Result<(), AppError> {
    entry.title = entry.title.trim().chars().take(300).collect();
    entry.category = entry.category.trim().chars().take(100).collect();
    entry.source = entry.source.trim().chars().take(300).collect();
    entry.content = entry.content.chars().take(100_000).collect();
    entry.tags = entry
        .tags
        .into_iter()
        .map(|tag| tag.trim().chars().take(80).collect::<String>())
        .filter(|tag| !tag.is_empty())
        .take(50)
        .collect();
    if entry.title.is_empty() || entry.content.trim().is_empty() {
        return Err(AppError::Agent(
            "Knowledge title and content are required".to_string(),
        ));
    }
    if entry.source.is_empty() {
        entry.source = "user".to_string();
    }
    if !matches!(
        entry.trust_level.as_str(),
        "verified" | "reviewed" | "unverified"
    ) {
        entry.trust_level = "unverified".to_string();
    }
    let now = chrono::Utc::now().to_rfc3339();
    if entry.created_at.trim().is_empty() {
        entry.created_at = now.clone();
    }
    entry.updated_at = now;
    let store = state
        .get_knowledge_store()
        .await
        .map_err(|e| AppError::Agent(e))?;
    store
        .save_entry(&entry)
        .await
        .map_err(|e| AppError::Agent(e))
}

/// Delete a domain knowledge base entry.
#[tauri::command]
pub async fn agent_delete_knowledge(
    state: State<'_, AppState>,
    id: String,
) -> Result<(), AppError> {
    let store = state
        .get_knowledge_store()
        .await
        .map_err(|e| AppError::Agent(e))?;
    store
        .delete_entry(&id)
        .await
        .map_err(|e| AppError::Agent(e))
}

/// List agent execution traces for audit review.
#[tauri::command]
pub async fn agent_list_traces(
    state: State<'_, AppState>,
    limit: Option<usize>,
) -> Result<Vec<AgentTrace>, AppError> {
    let store = state
        .get_trace_store()
        .await
        .map_err(|e| AppError::Agent(e))?;
    store
        .list_traces(limit.unwrap_or(20).clamp(1, 200))
        .await
        .map_err(|e| AppError::Agent(e))
}
