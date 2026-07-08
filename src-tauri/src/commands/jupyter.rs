//! Tauri IPC commands for Jupyter server operations.
//!
//! These commands are exposed to the frontend via Tauri's invoke mechanism.

use tauri::{AppHandle, Emitter, State};

use crate::error::AppError;
use crate::jupyter::client::JupyterClient;
use crate::jupyter::types::*;
use crate::state::{AppState, ManagedConnection};

// ─── Connection Management ─────────────────────────────────────────────

/// Connect to a remote Jupyter server.
#[tauri::command]
pub async fn jupyter_connect(
    state: State<'_, AppState>,
    app: AppHandle,
    config: JupyterServerConfig,
) -> Result<ServerConnection, AppError> {
    // Emit connecting status
    let _ = app.emit(
        "jupyter:connection",
        serde_json::json!({
            "server_id": &config.id,
            "status": "connecting",
        }),
    );

    // Build the client with proxy configuration
    let client = JupyterClient::new(&config)?;

    // Test the connection by fetching server info
    let server_info = match client.get_server_info().await {
        Ok(info) => {
            let _ = app.emit(
                "jupyter:connection",
                serde_json::json!({
                    "server_id": &config.id,
                    "status": "connected",
                }),
            );
            Some(info)
        }
        Err(e) => {
            let error_msg = e.to_string();
            let _ = app.emit(
                "jupyter:connection",
                serde_json::json!({
                    "server_id": &config.id,
                    "status": "error",
                    "message": &error_msg,
                }),
            );

            // Still store the connection so user can retry
            let mut connections = state.connections.write().await;
            connections.insert(
                config.id.clone(),
                ManagedConnection {
                    client,
                    status: ConnectionStatus::Error,
                    server_info: None,
                    config: config.clone(),
                    error_message: Some(error_msg.clone()),
                },
            );

            return Err(AppError::JupyterConnection(error_msg));
        }
    };

    // Store the successful connection
    let connection_info = ServerConnection {
        config: config.clone(),
        status: ConnectionStatus::Connected,
        server_info: server_info.clone(),
        error_message: None,
    };

    let mut connections = state.connections.write().await;
    connections.insert(
        config.id.clone(),
        ManagedConnection {
            client,
            status: ConnectionStatus::Connected,
            server_info,
            config: config.clone(),
            error_message: None,
        },
    );

    // Set as active server if it's the first connection
    let mut active_id = state.active_server_id.write().await;
    if active_id.is_none() {
        *active_id = Some(config.id.clone());
    }

    Ok(connection_info)
}

/// Log into a JupyterHub/TLJH server using username and password, obtain a token,
/// check/spawn the user's server, and connect to it.
#[tauri::command]
pub async fn jupyter_hub_login(
    state: State<'_, AppState>,
    app: AppHandle,
    req: JupyterHubLoginRequest,
) -> Result<ServerConnection, AppError> {
    let mut base_url = req.url.trim().trim_end_matches('/').to_string();
    if base_url.ends_with("/hub") {
        base_url = base_url.strip_suffix("/hub").unwrap().to_string();
    }

    let id = req
        .id
        .clone()
        .unwrap_or_else(|| uuid::Uuid::new_v4().to_string());
    let _ = app.emit(
        "jupyter:connection",
        serde_json::json!({
            "server_id": &id,
            "status": "connecting",
            "message": "Authenticating with JupyterHub..."
        }),
    );

    let http = crate::jupyter::client::build_http_client(req.proxy.as_ref())?;

    // Step 1: Request token (JupyterHub 2.0+ standard endpoint first, then legacy 1.x fallback)
    let token_url_v2 = format!("{}/hub/api/users/{}/tokens", base_url, req.username);
    let auth_body_v2 = serde_json::json!({
        "auth": {
            "username": req.username,
            "password": req.password,
        },
        "note": "LabNexus Desktop"
    });

    let mut res = http
        .post(&token_url_v2)
        .json(&auth_body_v2)
        .send()
        .await
        .map_err(|e| {
            AppError::JupyterConnection(format!("Failed to connect to JupyterHub: {}", e))
        })?;

    // If 404 Not Found, fallback to legacy endpoint /hub/api/authorizations/token
    if res.status() == reqwest::StatusCode::NOT_FOUND {
        let token_url_v1 = format!("{}/hub/api/authorizations/token", base_url);
        let auth_body_v1 = serde_json::json!({
            "username": req.username,
            "password": req.password,
        });
        if let Ok(res_v1) = http.post(&token_url_v1).json(&auth_body_v1).send().await {
            res = res_v1;
        }
    }

    let status = res.status();
    if !status.is_success() {
        let err_text = res
            .text()
            .await
            .unwrap_or_else(|_| "Unknown error".to_string());
        let msg = format!(
            "JupyterHub login failed (HTTP {}): {}",
            status.as_u16(),
            err_text
        );
        let _ = app.emit(
            "jupyter:connection",
            serde_json::json!({
                "server_id": &id,
                "status": "error",
                "message": &msg
            }),
        );
        return Err(AppError::JupyterConnection(msg));
    }

    let res_json: serde_json::Value = res
        .json()
        .await
        .map_err(|e| AppError::Serialization(format!("Failed to parse token response: {}", e)))?;

    let token = res_json
        .get("token")
        .and_then(|t| t.as_str())
        .ok_or_else(|| AppError::JupyterConnection("No token returned by JupyterHub".to_string()))?
        .to_string();

    // Step 2: Check & spawn user server
    let _ = app.emit(
        "jupyter:connection",
        serde_json::json!({
            "server_id": &id,
            "status": "connecting",
            "message": "Checking server status..."
        }),
    );

    let user_url = format!("{}/hub/api/users/{}", base_url, req.username);
    let mut server_path = format!("/user/{}/", req.username);
    let mut is_ready = false;

    // Check user model
    if let Ok(user_res) = http
        .get(&user_url)
        .header("Authorization", format!("token {}", token))
        .send()
        .await
    {
        if user_res.status().is_success() {
            if let Ok(user_data) = user_res.json::<serde_json::Value>().await {
                // Check if any server is ready
                if let Some(servers) = user_data.get("servers").and_then(|s| s.as_object()) {
                    for (_, srv) in servers {
                        if srv.get("ready").and_then(|r| r.as_bool()) == Some(true) {
                            is_ready = true;
                            if let Some(url) = srv.get("url").and_then(|u| u.as_str()) {
                                server_path = url.to_string();
                            }
                            break;
                        }
                    }
                }
            }
        }
    }

    // If not ready, spawn server
    if !is_ready {
        let _ = app.emit(
            "jupyter:connection",
            serde_json::json!({
                "server_id": &id,
                "status": "connecting",
                "message": "Spawning Jupyter server..."
            }),
        );

        let spawn_url = format!("{}/hub/api/users/{}/servers/", base_url, req.username);
        let _ = http
            .post(&spawn_url)
            .header("Authorization", format!("token {}", token))
            .send()
            .await;

        // Poll for ready status up to 30 times (30s)
        for _ in 0..30 {
            tokio::time::sleep(std::time::Duration::from_secs(1)).await;
            if let Ok(user_res) = http
                .get(&user_url)
                .header("Authorization", format!("token {}", token))
                .send()
                .await
            {
                if user_res.status().is_success() {
                    if let Ok(user_data) = user_res.json::<serde_json::Value>().await {
                        if let Some(servers) = user_data.get("servers").and_then(|s| s.as_object())
                        {
                            for (_, srv) in servers {
                                if srv.get("ready").and_then(|r| r.as_bool()) == Some(true) {
                                    is_ready = true;
                                    if let Some(url) = srv.get("url").and_then(|u| u.as_str()) {
                                        server_path = url.to_string();
                                    }
                                    break;
                                }
                            }
                        }
                        if is_ready {
                            break;
                        }
                    }
                }
            }
        }
    }

    let final_url = format!("{}{}", base_url, server_path.trim_end_matches('/'));

    let config = JupyterServerConfig {
        id: id.clone(),
        name: req
            .name
            .unwrap_or_else(|| format!("{} @ {}", req.username, base_url)),
        base_url: final_url,
        token: Some(token),
        proxy: req.proxy,
    };

    // Connect using normal jupyter_connect flow
    jupyter_connect(state, app, config).await
}

/// Disconnect from a Jupyter server.
#[tauri::command]
pub async fn jupyter_disconnect(
    state: State<'_, AppState>,
    app: AppHandle,
    server_id: String,
) -> Result<(), AppError> {
    let mut connections = state.connections.write().await;
    connections.remove(&server_id);

    // If the active server was disconnected, clear or switch
    let mut active_id = state.active_server_id.write().await;
    if active_id.as_ref() == Some(&server_id) {
        *active_id = connections.keys().next().cloned();
    }

    let _ = app.emit(
        "jupyter:connection",
        serde_json::json!({
            "server_id": &server_id,
            "status": "disconnected",
        }),
    );

    Ok(())
}

/// List all server connections.
#[tauri::command]
pub async fn jupyter_list_servers(
    state: State<'_, AppState>,
) -> Result<Vec<ServerConnection>, AppError> {
    Ok(state.get_all_connections().await)
}

/// Set the active server.
#[tauri::command]
pub async fn jupyter_set_active(
    state: State<'_, AppState>,
    server_id: String,
) -> Result<(), AppError> {
    let connections = state.connections.read().await;
    if !connections.contains_key(&server_id) {
        return Err(AppError::ServerNotFound(server_id));
    }
    drop(connections);

    let mut active_id = state.active_server_id.write().await;
    *active_id = Some(server_id);
    Ok(())
}

/// Restart a stopped JupyterHub server from a Hub spawn URL and reconnect.
#[tauri::command]
pub async fn jupyter_restart_hub_server(
    state: State<'_, AppState>,
    app: AppHandle,
    server_id: String,
    restart_url: String,
) -> Result<ServerConnection, AppError> {
    let config = {
        let connections = state.connections.read().await;
        connections
            .get(&server_id)
            .map(|connection| connection.config.clone())
            .ok_or_else(|| AppError::ServerNotFound(server_id.clone()))?
    };
    let token = config.token.clone().ok_or_else(|| {
        AppError::JupyterAuth("Restarting a JupyterHub server requires a saved token".to_string())
    })?;
    let target = parse_hub_spawn_target(&restart_url)?;
    let http = crate::jupyter::client::build_http_client(config.proxy.as_ref())?;

    let _ = app.emit(
        "jupyter:connection",
        serde_json::json!({
            "server_id": &server_id,
            "status": "connecting",
            "message": "Restarting JupyterHub server..."
        }),
    );

    let spawn_res = http
        .post(target.spawn_api_url())
        .header("Authorization", format!("token {}", token))
        .send()
        .await
        .map_err(|e| AppError::JupyterConnection(format!("Failed to restart server: {}", e)))?;
    let spawn_status = spawn_res.status();
    if !spawn_status.is_success()
        && spawn_status != reqwest::StatusCode::BAD_REQUEST
        && spawn_status != reqwest::StatusCode::CONFLICT
    {
        let body = spawn_res
            .text()
            .await
            .unwrap_or_else(|_| "Unknown error".to_string());
        return Err(AppError::JupyterConnection(format!(
            "Failed to restart server (HTTP {}): {}",
            spawn_status.as_u16(),
            body
        )));
    }

    for _ in 0..30 {
        tokio::time::sleep(std::time::Duration::from_secs(1)).await;
        if hub_server_is_ready(&http, &target, &token).await {
            return jupyter_connect(state, app, config).await;
        }
    }

    Err(AppError::JupyterConnection(
        "Timed out waiting for JupyterHub server to restart".to_string(),
    ))
}

// ─── Contents API Commands ─────────────────────────────────────────────

/// List files and directories at a given path.
#[tauri::command]
pub async fn jupyter_list_contents(
    state: State<'_, AppState>,
    server_id: Option<String>,
    path: String,
) -> Result<ContentItem, AppError> {
    let client = get_client(&state, server_id.as_deref()).await?;
    client.list_contents(&path).await
}

/// Open/read a file or notebook.
#[tauri::command]
pub async fn jupyter_get_content(
    state: State<'_, AppState>,
    server_id: Option<String>,
    path: String,
) -> Result<ContentItem, AppError> {
    let client = get_client(&state, server_id.as_deref()).await?;
    client.get_content(&path).await
}

/// Save a file or notebook.
#[tauri::command]
pub async fn jupyter_save_content(
    state: State<'_, AppState>,
    server_id: Option<String>,
    path: String,
    content: serde_json::Value,
) -> Result<ContentItem, AppError> {
    let client = get_client(&state, server_id.as_deref()).await?;
    client.save_content(&path, &content).await
}

/// Create a new file, notebook, or directory.
#[tauri::command]
pub async fn jupyter_create_content(
    state: State<'_, AppState>,
    server_id: Option<String>,
    path: String,
    content_type: String,
) -> Result<ContentItem, AppError> {
    let client = get_client(&state, server_id.as_deref()).await?;
    client.create_content(&path, &content_type).await
}

/// Delete a file or directory.
#[tauri::command]
pub async fn jupyter_delete_content(
    state: State<'_, AppState>,
    server_id: Option<String>,
    path: String,
) -> Result<(), AppError> {
    let client = get_client(&state, server_id.as_deref()).await?;
    client.delete_content(&path).await
}

// ─── Kernel Commands ───────────────────────────────────────────────────

/// List running kernels.
#[tauri::command]
pub async fn jupyter_list_kernels(
    state: State<'_, AppState>,
    server_id: Option<String>,
) -> Result<Vec<KernelInfo>, AppError> {
    let client = get_client(&state, server_id.as_deref()).await?;
    client.list_kernels().await
}

/// Start a new kernel.
#[tauri::command]
pub async fn jupyter_start_kernel(
    state: State<'_, AppState>,
    server_id: Option<String>,
    kernel_name: String,
) -> Result<KernelInfo, AppError> {
    let client = get_client(&state, server_id.as_deref()).await?;
    client.start_kernel(&kernel_name).await
}

/// Shutdown a kernel.
#[tauri::command]
pub async fn jupyter_shutdown_kernel(
    state: State<'_, AppState>,
    server_id: Option<String>,
    kernel_id: String,
) -> Result<(), AppError> {
    let client = get_client(&state, server_id.as_deref()).await?;
    client.shutdown_kernel(&kernel_id).await
}

/// Interrupt a running kernel.
#[tauri::command]
pub async fn jupyter_interrupt_kernel(
    state: State<'_, AppState>,
    server_id: Option<String>,
    kernel_id: String,
) -> Result<(), AppError> {
    let client = get_client(&state, server_id.as_deref()).await?;
    client.interrupt_kernel(&kernel_id).await
}

/// Restart a kernel.
#[tauri::command]
pub async fn jupyter_restart_kernel(
    state: State<'_, AppState>,
    server_id: Option<String>,
    kernel_id: String,
) -> Result<(), AppError> {
    let client = get_client(&state, server_id.as_deref()).await?;
    client.restart_kernel(&kernel_id).await
}

// ─── Session Commands ──────────────────────────────────────────────────

/// List active sessions.
#[tauri::command]
pub async fn jupyter_list_sessions(
    state: State<'_, AppState>,
    server_id: Option<String>,
) -> Result<Vec<SessionInfo>, AppError> {
    let client = get_client(&state, server_id.as_deref()).await?;
    client.list_sessions().await
}

/// Create a session (open notebook with kernel).
#[tauri::command]
pub async fn jupyter_create_session(
    state: State<'_, AppState>,
    server_id: Option<String>,
    path: String,
    kernel_name: String,
) -> Result<SessionInfo, AppError> {
    log::info!(
        "[KernelCmd] Creating session for notebook '{}' with kernel '{}'",
        path,
        kernel_name
    );
    let client = get_client(&state, server_id.as_deref()).await?;
    let session = client.create_session(&path, &kernel_name).await?;
    log::info!(
        "[KernelCmd] Session created: id={}, kernel_id={}",
        session.id,
        session.kernel.id
    );
    Ok(session)
}

// ─── Kernel WebSocket Commands ─────────────────────────────────────────

/// Connect to a kernel's WebSocket channel for real-time execution and streaming.
#[tauri::command]
pub async fn jupyter_connect_kernel_ws(
    state: State<'_, AppState>,
    app: AppHandle,
    kernel_id: String,
    server_id: Option<String>,
) -> Result<(), AppError> {
    log::info!(
        "[KernelCmd] Connecting kernel WebSocket for kernel_id={}",
        kernel_id
    );
    let client = get_client(&state, server_id.as_deref()).await?;
    let ws_url = client.kernel_ws_url(&kernel_id)?;
    log::info!("[KernelCmd] Kernel WebSocket URL: {}", ws_url);

    // Retrieve the server config
    let connections = state.connections.read().await;
    let conn = connections
        .get(client.server_id())
        .ok_or_else(|| AppError::ServerNotFound(client.server_id().to_string()))?;
    let config = conn.config.clone();
    drop(connections);

    state
        .kernel_ws
        .connect(app, &config, &kernel_id, &ws_url)
        .await
}

/// Send a JSON message to a connected kernel WebSocket.
#[tauri::command]
pub async fn jupyter_send_kernel_msg(
    state: State<'_, AppState>,
    kernel_id: String,
    msg: serde_json::Value,
) -> Result<(), AppError> {
    let msg_type = msg
        .get("header")
        .and_then(|h| h.get("msg_type"))
        .and_then(|t| t.as_str())
        .unwrap_or("unknown");
    log::info!("[KernelCmd] Sending {} to kernel {}", msg_type, kernel_id);
    let msg_str = serde_json::to_string(&msg)
        .map_err(|e| AppError::Serialization(format!("Failed to serialize message: {}", e)))?;
    log::debug!("[KernelCmd] Message payload: {} bytes", msg_str.len());
    match state.kernel_ws.send_message(&kernel_id, msg_str).await {
        Ok(()) => {
            log::info!("[KernelCmd] Sent {} to kernel {}", msg_type, kernel_id);
            Ok(())
        }
        Err(e) => {
            log::error!(
                "[KernelCmd] Failed to send {} to kernel {}: {}",
                msg_type,
                kernel_id,
                e
            );
            Err(e)
        }
    }
}

/// Disconnect from a kernel WebSocket.
#[tauri::command]
pub async fn jupyter_disconnect_kernel_ws(
    state: State<'_, AppState>,
    kernel_id: String,
) -> Result<(), AppError> {
    state.kernel_ws.disconnect(&kernel_id).await;
    Ok(())
}

// ─── Terminal Commands ─────────────────────────────────────────────────

/// List active terminal sessions.
#[tauri::command]
pub async fn jupyter_list_terminals(
    state: State<'_, AppState>,
    server_id: Option<String>,
) -> Result<Vec<TerminalInfo>, AppError> {
    let client = get_client(&state, server_id.as_deref()).await?;
    client.list_terminals().await
}

/// Create a new terminal session.
#[tauri::command]
pub async fn jupyter_create_terminal(
    state: State<'_, AppState>,
    server_id: Option<String>,
) -> Result<TerminalInfo, AppError> {
    let client = get_client(&state, server_id.as_deref()).await?;
    client.create_terminal().await
}

/// Delete a terminal session.
#[tauri::command]
pub async fn jupyter_delete_terminal(
    state: State<'_, AppState>,
    server_id: Option<String>,
    name: String,
) -> Result<(), AppError> {
    let client = get_client(&state, server_id.as_deref()).await?;
    client.delete_terminal(&name).await
}

/// Connect to a terminal WebSocket channel.
#[tauri::command]
pub async fn jupyter_connect_terminal(
    state: State<'_, AppState>,
    app: AppHandle,
    name: String,
    server_id: Option<String>,
) -> Result<(), AppError> {
    let client = get_client(&state, server_id.as_deref()).await?;
    let ws_url = client.terminal_ws_url(&name)?;

    let connections = state.connections.read().await;
    let conn = connections
        .get(client.server_id())
        .ok_or_else(|| AppError::ServerNotFound(client.server_id().to_string()))?;
    let config = conn.config.clone();
    drop(connections);

    state
        .terminal_ws
        .connect(app, &config, &name, &ws_url)
        .await
}

/// Send input (stdin) to a connected terminal WebSocket.
#[tauri::command]
pub async fn jupyter_send_terminal_input(
    state: State<'_, AppState>,
    name: String,
    data: String,
    server_id: Option<String>,
) -> Result<(), AppError> {
    let client = get_client(&state, server_id.as_deref()).await?;
    state
        .terminal_ws
        .send_input(client.server_id(), &name, &data)
        .await
}

/// Resize a connected terminal WebSocket.
#[tauri::command]
pub async fn jupyter_resize_terminal(
    state: State<'_, AppState>,
    name: String,
    rows: u32,
    cols: u32,
    server_id: Option<String>,
) -> Result<(), AppError> {
    let client = get_client(&state, server_id.as_deref()).await?;
    state
        .terminal_ws
        .resize(client.server_id(), &name, rows, cols)
        .await
}

/// Disconnect from a terminal WebSocket.
#[tauri::command]
pub async fn jupyter_disconnect_terminal(
    state: State<'_, AppState>,
    name: String,
    server_id: Option<String>,
) -> Result<(), AppError> {
    let client = get_client(&state, server_id.as_deref()).await?;
    state
        .terminal_ws
        .disconnect(client.server_id(), &name)
        .await;
    Ok(())
}

// ─── Helpers ───────────────────────────────────────────────────────────

#[derive(Debug, PartialEq)]
struct HubSpawnTarget {
    base_url: String,
    username: String,
    server_name: Option<String>,
}

impl HubSpawnTarget {
    fn user_api_url(&self) -> String {
        format!("{}/hub/api/users/{}", self.base_url, self.username)
    }

    fn spawn_api_url(&self) -> String {
        match &self.server_name {
            Some(server_name) => format!(
                "{}/hub/api/users/{}/servers/{}",
                self.base_url, self.username, server_name
            ),
            None => format!("{}/hub/api/users/{}/servers/", self.base_url, self.username),
        }
    }
}

fn parse_hub_spawn_target(restart_url: &str) -> Result<HubSpawnTarget, AppError> {
    let parsed = url::Url::parse(restart_url)
        .map_err(|e| AppError::JupyterConnection(format!("Invalid restart URL: {}", e)))?;
    let base_url = format!(
        "{}://{}",
        parsed.scheme(),
        parsed
            .host_str()
            .ok_or_else(|| AppError::JupyterConnection("Restart URL missing host".to_string()))?
    );
    let base_url = match parsed.port() {
        Some(port) => format!("{}:{}", base_url, port),
        None => base_url,
    };
    let segments: Vec<_> = parsed
        .path_segments()
        .ok_or_else(|| AppError::JupyterConnection("Restart URL missing path".to_string()))?
        .collect();
    let spawn_index = segments
        .windows(2)
        .position(|window| window == ["hub", "spawn"])
        .ok_or_else(|| {
            AppError::JupyterConnection("Restart URL is not a JupyterHub spawn URL".to_string())
        })?;
    let username = segments
        .get(spawn_index + 2)
        .filter(|segment| !segment.is_empty())
        .ok_or_else(|| AppError::JupyterConnection("Restart URL missing username".to_string()))?
        .to_string();
    let server_name = segments
        .get(spawn_index + 3)
        .filter(|segment| !segment.is_empty())
        .map(|segment| segment.to_string());

    Ok(HubSpawnTarget {
        base_url,
        username,
        server_name,
    })
}

async fn hub_server_is_ready(
    http: &reqwest::Client,
    target: &HubSpawnTarget,
    token: &str,
) -> bool {
    let Ok(response) = http
        .get(target.user_api_url())
        .header("Authorization", format!("token {}", token))
        .send()
        .await
    else {
        return false;
    };
    if !response.status().is_success() {
        return false;
    }

    let Ok(user_data) = response.json::<serde_json::Value>().await else {
        return false;
    };
    let Some(servers) = user_data.get("servers").and_then(|value| value.as_object()) else {
        return false;
    };

    match &target.server_name {
        Some(server_name) => servers
            .get(server_name)
            .and_then(|server| server.get("ready"))
            .and_then(|ready| ready.as_bool())
            == Some(true),
        None => servers.values().any(|server| {
            server
                .get("ready")
                .and_then(|ready| ready.as_bool())
                == Some(true)
        }),
    }
}

/// Get a client for the specified server, or the active server if unspecified.
async fn get_client(state: &AppState, server_id: Option<&str>) -> Result<JupyterClient, AppError> {
    match server_id {
        Some(id) => state
            .get_client(id)
            .await
            .ok_or_else(|| AppError::ServerNotFound(id.to_string())),
        None => state.active_client().await.ok_or(AppError::NotConnected),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn hub_spawn_url_converts_to_default_server_api_paths() {
        let target = parse_hub_spawn_target("https://ius16.dataincity.com/hub/spawn/wlx")
            .expect("spawn URL should parse");

        assert_eq!(target.base_url, "https://ius16.dataincity.com");
        assert_eq!(target.username, "wlx");
        assert_eq!(target.server_name, None);
        assert_eq!(
            target.user_api_url(),
            "https://ius16.dataincity.com/hub/api/users/wlx"
        );
        assert_eq!(
            target.spawn_api_url(),
            "https://ius16.dataincity.com/hub/api/users/wlx/servers/"
        );
    }
}
