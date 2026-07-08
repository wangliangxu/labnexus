//! LabNexus — Tauri IPC commands for AI Agent.

use crate::agent::{
    load_ai_config, save_ai_config, AgentChatContext, AgentMessage, AgentTrace, AiConfig,
    KnowledgeEntry, Skill,
};
use crate::error::AppError;
use crate::state::AppState;
use tauri::{AppHandle, State};

/// Start or continue an agent chat/task in the ReAct loop.
#[tauri::command]
pub async fn agent_run_task(
    state: State<'_, AppState>,
    app: AppHandle,
    session_id: String,
    prompt: String,
    context: Option<AgentChatContext>,
) -> Result<(), AppError> {
    state
        .agent
        .run_task(&session_id, &prompt, context, &state, app)
        .await
}

/// Confirm or deny a pending tool call that requires user approval.
#[tauri::command]
pub async fn agent_confirm_tool(
    state: State<'_, AppState>,
    session_id: String,
    tool_call_id: String,
    approved: bool,
) -> Result<(), AppError> {
    state
        .agent
        .confirm_tool(&session_id, &tool_call_id, approved)
        .await
}

/// Retrieve the current AI configuration.
#[tauri::command]
pub async fn agent_get_config() -> Result<AiConfig, AppError> {
    Ok(load_ai_config())
}

/// Save AI configuration to disk.
#[tauri::command]
pub async fn agent_save_config(config: AiConfig) -> Result<(), AppError> {
    save_ai_config(&config)
}

/// Get conversation history for a session.
#[tauri::command]
pub async fn agent_get_history(
    state: State<'_, AppState>,
    session_id: String,
) -> Result<Vec<AgentMessage>, AppError> {
    Ok(state.agent.get_history(&session_id).await)
}

/// Clear conversation history for a session.
#[tauri::command]
pub async fn agent_clear_session(
    state: State<'_, AppState>,
    session_id: String,
) -> Result<(), AppError> {
    state.agent.clear_session(&session_id).await;
    Ok(())
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
    entry: KnowledgeEntry,
) -> Result<(), AppError> {
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
        .list_traces(limit.unwrap_or(20))
        .await
        .map_err(|e| AppError::Agent(e))
}
