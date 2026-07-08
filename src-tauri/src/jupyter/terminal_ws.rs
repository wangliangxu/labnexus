//! Jupyter Terminal WebSocket Manager.
//!
//! Manages WebSocket connections to remote Jupyter terminal sessions for real-time
//! interactive bash/zsh shell access.
//! Supports direct connections and SOCKS5 proxy tunneling (SSH -D).

use std::collections::HashMap;
use std::sync::Arc;
use tauri::{AppHandle, Emitter};
use tokio::sync::{mpsc, RwLock};
use tokio_tungstenite::tungstenite::protocol::Message;
use url::Url;

use crate::error::AppError;
use crate::jupyter::types::*;
use crate::jupyter::ws::connect_ws_stream;

/// Active WebSocket connection to a Jupyter terminal session.
pub struct TerminalConnection {
    /// Channel sender to send JSON string messages to the WebSocket write task.
    pub tx: mpsc::Sender<String>,
    /// Terminal name.
    pub terminal_name: String,
    /// Server ID this terminal belongs to.
    pub server_id: String,
}

/// Global manager for terminal WebSocket connections.
pub struct TerminalWsManager {
    /// Active connections keyed by `server_id:terminal_name`.
    connections: Arc<RwLock<HashMap<String, TerminalConnection>>>,
}

impl TerminalWsManager {
    /// Create a new TerminalWsManager.
    pub fn new() -> Self {
        Self {
            connections: Arc::new(RwLock::new(HashMap::new())),
        }
    }

    fn conn_key(server_id: &str, terminal_name: &str) -> String {
        format!("{}:{}", server_id, terminal_name)
    }

    /// Connect to a terminal's WebSocket channel and start read/write tasks.
    pub async fn connect(
        &self,
        app: AppHandle,
        config: &JupyterServerConfig,
        terminal_name: &str,
        ws_url: &str,
    ) -> Result<(), AppError> {
        let key = Self::conn_key(&config.id, terminal_name);
        self.disconnect(&config.id, terminal_name).await;

        let url = Url::parse(ws_url)
            .map_err(|e| AppError::JupyterConnection(format!("Invalid WebSocket URL: {}", e)))?;

        let ws_stream = connect_ws_stream(&url, config).await?;
        let (mut write_half, mut read_half) = futures_util::StreamExt::split(ws_stream);

        let (tx, mut rx) = mpsc::channel::<String>(100);

        {
            let mut conns = self.connections.write().await;
            conns.insert(
                key.clone(),
                TerminalConnection {
                    tx,
                    terminal_name: terminal_name.to_string(),
                    server_id: config.id.clone(),
                },
            );
        }

        let _ = app.emit(
            "jupyter:terminal_status",
            serde_json::json!({
                "server_id": &config.id,
                "terminal_name": terminal_name,
                "status": "connected",
            }),
        );

        let t_name_write = terminal_name.to_string();
        let s_id_write = config.id.clone();
        let app_write = app.clone();

        tokio::spawn(async move {
            use futures_util::SinkExt;
            while let Some(msg_str) = rx.recv().await {
                if let Err(e) = write_half.send(Message::Text(msg_str.into())).await {
                    log::error!("Error sending message to terminal {}: {}", t_name_write, e);
                    break;
                }
            }
            let _ = app_write.emit(
                "jupyter:terminal_status",
                serde_json::json!({
                    "server_id": &s_id_write,
                    "terminal_name": &t_name_write,
                    "status": "disconnected",
                }),
            );
        });

        let t_name_read = terminal_name.to_string();
        let s_id_read = config.id.clone();
        let app_read = app.clone();
        let conns_ref = self.connections.clone();
        let key_read = key.clone();

        tokio::spawn(async move {
            use futures_util::StreamExt;
            while let Some(msg_res) = read_half.next().await {
                match msg_res {
                    Ok(Message::Text(text)) => {
                        // Try to parse JSON array: ["stdout", "data"] or ["stdin", "data"]
                        if let Ok(arr) = serde_json::from_str::<Vec<serde_json::Value>>(&text) {
                            if arr.len() >= 2 {
                                let msg_type = arr[0].as_str().unwrap_or("");
                                if msg_type == "stdout" {
                                    if let Some(data) = arr[1].as_str() {
                                        let _ = app_read.emit(
                                            "jupyter:terminal_output",
                                            serde_json::json!({
                                                "server_id": &s_id_read,
                                                "terminal_name": &t_name_read,
                                                "data": data,
                                            }),
                                        );
                                    }
                                } else if msg_type == "disconnect" {
                                    log::info!("Terminal {} disconnected by server", t_name_read);
                                    break;
                                }
                            }
                        } else {
                            // Raw output fallback
                            let _ = app_read.emit(
                                "jupyter:terminal_output",
                                serde_json::json!({
                                    "server_id": &s_id_read,
                                    "terminal_name": &t_name_read,
                                    "data": text,
                                }),
                            );
                        }
                    }
                    Ok(Message::Close(_)) => {
                        log::info!("WebSocket closed by terminal {}", t_name_read);
                        break;
                    }
                    Err(e) => {
                        log::error!("WebSocket read error from terminal {}: {}", t_name_read, e);
                        break;
                    }
                    _ => {}
                }
            }

            let mut conns = conns_ref.write().await;
            conns.remove(&key_read);

            let _ = app_read.emit(
                "jupyter:terminal_status",
                serde_json::json!({
                    "server_id": &s_id_read,
                    "terminal_name": &t_name_read,
                    "status": "disconnected",
                }),
            );
        });

        Ok(())
    }

    /// Send input (stdin) to an active terminal WebSocket.
    pub async fn send_input(
        &self,
        server_id: &str,
        terminal_name: &str,
        data: &str,
    ) -> Result<(), AppError> {
        let key = Self::conn_key(server_id, terminal_name);
        let conns = self.connections.read().await;
        if let Some(conn) = conns.get(&key) {
            let msg = serde_json::json!(["stdin", data]).to_string();
            conn.tx.send(msg).await.map_err(|e| {
                AppError::WebSocket(format!("Failed to send to terminal channel: {}", e))
            })?;
            Ok(())
        } else {
            Err(AppError::Other(format!(
                "Terminal WebSocket not connected: {}",
                terminal_name
            )))
        }
    }

    /// Resize an active terminal WebSocket session.
    pub async fn resize(
        &self,
        server_id: &str,
        terminal_name: &str,
        rows: u32,
        cols: u32,
    ) -> Result<(), AppError> {
        let key = Self::conn_key(server_id, terminal_name);
        let conns = self.connections.read().await;
        if let Some(conn) = conns.get(&key) {
            let msg = serde_json::json!(["set_size", rows, cols, 0, 0]).to_string();
            conn.tx.send(msg).await.map_err(|e| {
                AppError::WebSocket(format!("Failed to send resize to terminal channel: {}", e))
            })?;
            Ok(())
        } else {
            Err(AppError::Other(format!(
                "Terminal WebSocket not connected: {}",
                terminal_name
            )))
        }
    }

    /// Disconnect from a terminal WebSocket.
    pub async fn disconnect(&self, server_id: &str, terminal_name: &str) {
        let key = Self::conn_key(server_id, terminal_name);
        let mut conns = self.connections.write().await;
        if let Some(conn) = conns.remove(&key) {
            drop(conn);
        }
    }
}

impl Default for TerminalWsManager {
    fn default() -> Self {
        Self::new()
    }
}
