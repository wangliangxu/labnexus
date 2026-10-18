//! LabNexus — Jupyter tool implementations for MCP Tool Registry.

use crate::agent::AgentChatContext;
use crate::error::AppError;
use crate::state::AppState;
use serde_json::json;
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter};
use tokio::time::timeout;

/// Execute Python code in the active kernel session and return the execution stdout/result/error.
pub async fn execute_cell(
    arguments: &serde_json::Value,
    context: &AgentChatContext,
    state: &AppState,
) -> Result<String, AppError> {
    let code = arguments["code"]
        .as_str()
        .ok_or_else(|| AppError::Agent("Missing required parameter 'code'".to_string()))?;

    let k_id = context.kernel_id.as_deref().ok_or_else(|| {
        AppError::Agent("Missing kernel_id in active workspace context".to_string())
    })?;
    let server_id = context.server_id.as_deref().ok_or_else(|| {
        AppError::Agent("Missing server_id in active workspace context".to_string())
    })?;
    if !state
        .kernel_ws
        .is_connected_to_server(k_id, server_id)
        .await
    {
        return Err(AppError::Agent(format!(
            "Kernel '{}' is not connected to server '{}'",
            k_id, server_id
        )));
    }
    let mut rx = state.kernel_ws.subscribe(k_id).await;

    let msg_id = uuid::Uuid::new_v4().to_string();
    let req = json!({
        "header": {
            "msg_id": msg_id,
            "msg_type": "execute_request",
            "username": "labnexus_agent",
            "session": "agent_session",
            "date": chrono::Utc::now().to_rfc3339(),
            "version": "5.3"
        },
        "parent_header": {},
        "metadata": {},
        "content": {
            "code": code,
            "silent": false,
            "store_history": true,
            "user_expressions": {},
            "allow_stdin": false,
            "stop_on_error": true
        },
        "channel": "shell"
    });

    state
        .kernel_ws
        .send_message(
            k_id,
            serde_json::to_string(&req).map_err(|e| AppError::Serialization(e.to_string()))?,
        )
        .await?;

    let mut output_str = String::new();
    let mut is_error = false;
    let mut completed = false;
    let start = Instant::now();

    while Instant::now().duration_since(start) < Duration::from_secs(60) {
        if let Ok(msg_res) = timeout(Duration::from_millis(500), rx.recv()).await {
            match msg_res {
                Ok(json_val) => {
                    let parent_id = json_val["parent_header"]["msg_id"]
                        .as_str()
                        .unwrap_or_default();
                    if parent_id == msg_id {
                        let msg_type = json_val["header"]["msg_type"].as_str().unwrap_or_default();
                        let content = &json_val["content"];

                        if msg_type == "stream" {
                            if let Some(text) = content["text"].as_str() {
                                output_str.push_str(text);
                            }
                        } else if msg_type == "execute_result" || msg_type == "display_data" {
                            if let Some(data) = content["data"]["text/plain"].as_str() {
                                if !output_str.is_empty() && !output_str.ends_with('\n') {
                                    output_str.push('\n');
                                }
                                output_str.push_str(data);
                            }
                        } else if msg_type == "error" {
                            is_error = true;
                            let ename = content["ename"].as_str().unwrap_or("Error");
                            let evalue = content["evalue"].as_str().unwrap_or("");
                            output_str = format!("{}: {}", ename, evalue);
                            if let Some(tb) = content["traceback"].as_array() {
                                let tb_str: Vec<&str> =
                                    tb.iter().filter_map(|v| v.as_str()).collect();
                                output_str.push_str("\nTraceback:\n");
                                output_str.push_str(&tb_str.join("\n"));
                            }
                        } else if msg_type == "status" {
                            if content["execution_state"].as_str() == Some("idle") {
                                completed = true;
                                break;
                            }
                        }
                    }
                }
                Err(tokio::sync::broadcast::error::RecvError::Closed) => {
                    return Err(AppError::Agent(
                        "Kernel message channel closed during execution".to_string(),
                    ));
                }
                Err(tokio::sync::broadcast::error::RecvError::Lagged(skipped)) => {
                    return Err(AppError::Agent(format!(
                        "Kernel output channel lagged; {} messages were lost",
                        skipped
                    )));
                }
            }
        }
    }

    if !completed {
        return Err(AppError::Agent(
            "Kernel execution timed out after 60 seconds".to_string(),
        ));
    }

    if is_error {
        return Err(AppError::Agent(if output_str.is_empty() {
            "Kernel execution failed without a detailed error".to_string()
        } else {
            output_str
        }));
    }

    if output_str.is_empty() {
        Ok("Code executed successfully (no output generated).".to_string())
    } else {
        Ok(output_str)
    }
}

/// Emit an event to add a new cell to the active notebook editor.
pub async fn add_cell(
    arguments: &serde_json::Value,
    context: &AgentChatContext,
    state: &AppState,
    app: &AppHandle,
) -> Result<String, AppError> {
    let cell_type = arguments["cell_type"].as_str().unwrap_or("code");
    let source = arguments["source"].as_str().unwrap_or_default();
    let position = arguments["position"].as_str().unwrap_or("below");

    request_notebook_action(
        state,
        app,
        context,
        "add_cell",
        json!({
            "cell_type": cell_type,
            "source": source,
            "position": position,
        }),
    )
    .await
}

/// Emit an event to update an existing cell in the active notebook editor.
pub async fn update_cell(
    arguments: &serde_json::Value,
    context: &AgentChatContext,
    state: &AppState,
    app: &AppHandle,
) -> Result<String, AppError> {
    let source = arguments["source"]
        .as_str()
        .ok_or_else(|| AppError::Agent("Missing required parameter 'source'".to_string()))?;
    let cell_index = arguments["cell_index"]
        .as_u64()
        .map(|idx| idx as usize)
        .or(context.active_cell_index);
    let cell_type = arguments["cell_type"].as_str();

    request_notebook_action(
        state,
        app,
        context,
        "update_cell",
        json!({
            "cell_index": cell_index,
            "source": source,
            "cell_type": cell_type,
        }),
    )
    .await
}

/// Emit an event to delete an existing cell from the active notebook editor.
pub async fn delete_cell(
    arguments: &serde_json::Value,
    context: &AgentChatContext,
    state: &AppState,
    app: &AppHandle,
) -> Result<String, AppError> {
    let cell_index = arguments["cell_index"]
        .as_u64()
        .map(|idx| idx as usize)
        .or(context.active_cell_index)
        .ok_or_else(|| AppError::Agent("Missing required parameter 'cell_index'".to_string()))?;

    request_notebook_action(
        state,
        app,
        context,
        "delete_cell",
        json!({
            "cell_index": cell_index,
        }),
    )
    .await
}

/// List all cells in the active notebook (prefers live editor state, falls back to remote file).
pub async fn list_cells(
    context: &AgentChatContext,
    state: &AppState,
    app: &AppHandle,
) -> Result<String, AppError> {
    if let Ok(live_result) =
        request_notebook_action(state, app, context, "list_cells", json!({})).await
    {
        return Ok(live_result);
    }

    let notebook_path = context.notebook_path.as_deref().ok_or_else(|| {
        AppError::Agent("Missing notebook_path in active workspace context".to_string())
    })?;
    let server_id = context.server_id.as_deref().ok_or_else(|| {
        AppError::Agent("Missing server_id in active workspace context".to_string())
    })?;
    let client = state
        .get_client(server_id)
        .await
        .ok_or(AppError::NotConnected)?;

    let item = client.get_content(notebook_path).await?;
    let cells = item
        .content
        .as_ref()
        .and_then(|c| c.get("cells"))
        .and_then(|c| c.as_array())
        .ok_or_else(|| AppError::Agent("Notebook has no readable cells array".to_string()))?;

    let mut summary = format!(
        "Notebook '{}' ({} cells):\n",
        notebook_path,
        cells.len()
    );
    for (idx, cell) in cells.iter().enumerate() {
        let cell_type = cell["cell_type"].as_str().unwrap_or("code");
        let exec_count = cell["execution_count"]
            .as_u64()
            .map(|n| n.to_string())
            .unwrap_or_else(|| " ".to_string());
        let source = match &cell["source"] {
            serde_json::Value::String(s) => s.clone(),
            serde_json::Value::Array(lines) => lines
                .iter()
                .filter_map(|l| l.as_str())
                .collect::<Vec<_>>()
                .join(""),
            _ => String::new(),
        };
        summary.push_str(&format!(
            "\n--- Cell {} [{}] (In [{}]) ---\n{}\n",
            idx, cell_type, exec_count, source
        ));
    }
    Ok(summary)
}

/// Emit an event to trigger saving the active notebook in the editor.
pub async fn save_notebook(
    context: &AgentChatContext,
    state: &AppState,
    app: &AppHandle,
) -> Result<String, AppError> {
    request_notebook_action(state, app, context, "save", json!({})).await
}

async fn request_notebook_action(
    state: &AppState,
    app: &AppHandle,
    context: &AgentChatContext,
    action: &str,
    arguments: serde_json::Value,
) -> Result<String, AppError> {
    let notebook_path = context.notebook_path.as_deref().ok_or_else(|| {
        AppError::Agent("Missing notebook_path in active workspace context".to_string())
    })?;
    let server_id = context.server_id.as_deref().ok_or_else(|| {
        AppError::Agent("Missing server_id in active workspace context".to_string())
    })?;
    let action_id = uuid::Uuid::new_v4().to_string();
    let (tx, rx) = tokio::sync::oneshot::channel();
    state
        .pending_notebook_actions
        .write()
        .await
        .insert(action_id.clone(), tx);

    if let Err(error) = app.emit(
        "agent:notebook_action",
        json!({
            "action_id": action_id,
            "action": action,
            "server_id": server_id,
            "notebook_path": notebook_path,
            "active_cell_id": context.active_cell_id,
            "active_cell_index": context.active_cell_index,
            "arguments": arguments,
        }),
    ) {
        state
            .pending_notebook_actions
            .write()
            .await
            .remove(&action_id);
        return Err(AppError::Agent(format!(
            "Failed to dispatch notebook action: {}",
            error
        )));
    }

    match timeout(Duration::from_secs(15), rx).await {
        Ok(Ok(Ok(message))) => Ok(message),
        Ok(Ok(Err(message))) => Err(AppError::Agent(message)),
        Ok(Err(_)) => Err(AppError::Agent(
            "Notebook action acknowledgement channel closed".to_string(),
        )),
        Err(_) => {
            state
                .pending_notebook_actions
                .write()
                .await
                .remove(&action_id);
            Err(AppError::Agent(
                "Notebook editor did not acknowledge the action within 15 seconds".to_string(),
            ))
        }
    }
}

/// List files and directories at a given path in the remote Jupyter workspace.
pub async fn list_files(
    arguments: &serde_json::Value,
    context: &AgentChatContext,
    state: &AppState,
) -> Result<String, AppError> {
    let path = arguments["path"].as_str().unwrap_or("");
    let server_id = context.server_id.as_deref().ok_or_else(|| {
        AppError::Agent("Missing server_id in active workspace context".to_string())
    })?;
    let client = state
        .get_client(server_id)
        .await
        .ok_or(AppError::NotConnected)?;

    let item = client.list_contents(path).await?;
    let entries = item
        .content
        .as_ref()
        .and_then(|c| c.as_array())
        .cloned()
        .unwrap_or_default();
    if entries.is_empty() {
        return Ok(format!(
            "Directory '{}' is empty.",
            if path.is_empty() { "/" } else { path }
        ));
    }
    let mut lines = vec![format!(
        "Contents of '{}':",
        if path.is_empty() { "/" } else { path }
    )];
    for entry in entries {
        let name = entry["name"].as_str().unwrap_or("?");
        let entry_path = entry["path"].as_str().unwrap_or(name);
        let ctype = entry["content_type"]
            .as_str()
            .or_else(|| entry["type"].as_str())
            .unwrap_or("file");
        let size = entry["size"]
            .as_u64()
            .map(|b| format!(" ({} B)", b))
            .unwrap_or_default();
        lines.push(format!("- [{}] {}{}", ctype, entry_path, size));
    }
    Ok(lines.join("\n"))
}

/// Read a file from the remote Jupyter workspace.
pub async fn read_file(
    arguments: &serde_json::Value,
    context: &AgentChatContext,
    state: &AppState,
) -> Result<String, AppError> {
    let path = arguments["path"]
        .as_str()
        .ok_or_else(|| AppError::Agent("Missing required parameter 'path'".to_string()))?;

    let server_id = context.server_id.as_deref().ok_or_else(|| {
        AppError::Agent("Missing server_id in active workspace context".to_string())
    })?;
    let client = state
        .get_client(server_id)
        .await
        .ok_or(AppError::NotConnected)?;

    let item = client.get_content(path).await?;
    if let Some(content) = item.content {
        match content {
            serde_json::Value::String(s) => Ok(s),
            other => Ok(serde_json::to_string_pretty(&other).unwrap_or_default()),
        }
    } else {
        Ok("File exists but is empty or unreadable.".to_string())
    }
}

/// Write a text or code file to the remote Jupyter workspace.
pub async fn write_file(
    arguments: &serde_json::Value,
    context: &AgentChatContext,
    state: &AppState,
) -> Result<String, AppError> {
    let path = arguments["path"]
        .as_str()
        .ok_or_else(|| AppError::Agent("Missing required parameter 'path'".to_string()))?;
    let content = arguments["content"]
        .as_str()
        .ok_or_else(|| AppError::Agent("Missing required parameter 'content'".to_string()))?;

    let server_id = context.server_id.as_deref().ok_or_else(|| {
        AppError::Agent("Missing server_id in active workspace context".to_string())
    })?;
    let client = state
        .get_client(server_id)
        .await
        .ok_or(AppError::NotConnected)?;

    let payload = json!({
        "type": "file",
        "format": "text",
        "content": content,
    });
    client.save_content(path, &payload).await?;
    Ok(format!(
        "Successfully wrote {} chars to '{}'.",
        content.chars().count(),
        path
    ))
}

/// Restart the currently active Jupyter kernel.
pub async fn restart_kernel(
    context: &AgentChatContext,
    state: &AppState,
) -> Result<String, AppError> {
    let k_id = context.kernel_id.as_deref().ok_or_else(|| {
        AppError::Agent("Missing kernel_id in active workspace context".to_string())
    })?;
    let server_id = context.server_id.as_deref().ok_or_else(|| {
        AppError::Agent("Missing server_id in active workspace context".to_string())
    })?;
    if !state
        .kernel_ws
        .is_connected_to_server(k_id, server_id)
        .await
    {
        return Err(AppError::Agent(format!(
            "Kernel '{}' is not connected to server '{}'",
            k_id, server_id
        )));
    }
    let client = state
        .get_client(server_id)
        .await
        .ok_or(AppError::NotConnected)?;
    client.restart_kernel(k_id).await?;
    Ok("Kernel restarted successfully. All variables cleared.".to_string())
}

/// Interrupt the kernel explicitly bound to the Agent session context.
pub async fn interrupt_kernel(
    context: &AgentChatContext,
    state: &AppState,
) -> Result<String, AppError> {
    let k_id = context.kernel_id.as_deref().ok_or_else(|| {
        AppError::Agent("Missing kernel_id in active workspace context".to_string())
    })?;
    let server_id = context.server_id.as_deref().ok_or_else(|| {
        AppError::Agent("Missing server_id in active workspace context".to_string())
    })?;
    if !state
        .kernel_ws
        .is_connected_to_server(k_id, server_id)
        .await
    {
        return Err(AppError::Agent(format!(
            "Kernel '{}' is not connected to server '{}'",
            k_id, server_id
        )));
    }
    let client = state
        .get_client(server_id)
        .await
        .ok_or(AppError::NotConnected)?;
    client.interrupt_kernel(k_id).await?;
    Ok(format!("Kernel '{}' interrupt requested.", k_id))
}
