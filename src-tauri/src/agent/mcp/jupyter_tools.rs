//! LabNexus — Jupyter tool implementations for MCP Tool Registry.

use crate::error::AppError;
use crate::state::AppState;
use serde_json::json;
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter};
use tokio::time::timeout;

/// Execute Python code in the active kernel session and return the execution stdout/result/error.
pub async fn execute_cell(
    arguments: &serde_json::Value,
    state: &AppState,
) -> Result<String, AppError> {
    let code = arguments["code"]
        .as_str()
        .ok_or_else(|| AppError::Agent("Missing required parameter 'code'".to_string()))?;

    let k_ids = state.kernel_ws.get_connected_kernel_ids().await;
    if k_ids.is_empty() {
        return Err(AppError::Agent(
            "No active Jupyter kernel connected. Please open a notebook and connect to a kernel first."
                .to_string(),
        ));
    }
    let k_id = &k_ids[0];
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
    let start = Instant::now();

    while Instant::now().duration_since(start) < Duration::from_secs(60) {
        if let Ok(msg_res) = timeout(Duration::from_millis(500), rx.recv()).await {
            if let Ok(json_val) = msg_res {
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
                            let tb_str: Vec<&str> = tb.iter().filter_map(|v| v.as_str()).collect();
                            output_str.push_str("\nTraceback:\n");
                            output_str.push_str(&tb_str.join("\n"));
                        }
                    } else if msg_type == "status" {
                        if content["execution_state"].as_str() == Some("idle") {
                            break;
                        }
                    }
                }
            }
        }
    }

    if output_str.is_empty() {
        if is_error {
            Ok("Error occurred during execution with no detailed message.".to_string())
        } else {
            Ok("Code executed successfully (no output generated).".to_string())
        }
    } else {
        Ok(output_str)
    }
}

/// Emit an event to add a new cell to the active notebook editor.
pub async fn add_cell(arguments: &serde_json::Value, app: &AppHandle) -> Result<String, AppError> {
    let cell_type = arguments["cell_type"].as_str().unwrap_or("code");
    let source = arguments["source"].as_str().unwrap_or_default();
    let position = arguments["position"].as_str().unwrap_or("below");

    app.emit(
        "notebook:add_cell",
        json!({
            "cell_type": cell_type,
            "source": source,
            "position": position,
        }),
    )
    .map_err(|e| AppError::Agent(format!("Failed to emit add_cell event: {}", e)))?;

    Ok(format!(
        "Successfully added a new {} cell {} current position.",
        cell_type, position
    ))
}

/// Emit an event to trigger saving the active notebook in the editor.
pub async fn save_notebook(app: &AppHandle) -> Result<String, AppError> {
    app.emit("notebook:save", json!({}))
        .map_err(|e| AppError::Agent(format!("Failed to emit save event: {}", e)))?;
    Ok("Requested notebook save from editor.".to_string())
}

/// Read a file from the remote Jupyter workspace.
pub async fn read_file(
    arguments: &serde_json::Value,
    state: &AppState,
) -> Result<String, AppError> {
    let path = arguments["path"]
        .as_str()
        .ok_or_else(|| AppError::Agent("Missing required parameter 'path'".to_string()))?;

    let client = state.active_client().await.ok_or(AppError::NotConnected)?;

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

/// Restart the currently active Jupyter kernel.
pub async fn restart_kernel(state: &AppState) -> Result<String, AppError> {
    let k_ids = state.kernel_ws.get_connected_kernel_ids().await;
    if k_ids.is_empty() {
        return Err(AppError::Agent("No active kernel to restart.".to_string()));
    }
    let k_id = &k_ids[0];
    let client = state.active_client().await.ok_or(AppError::NotConnected)?;
    client.restart_kernel(k_id).await?;
    Ok("Kernel restarted successfully. All variables cleared.".to_string())
}
