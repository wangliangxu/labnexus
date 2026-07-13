//! Jupyter Kernel WebSocket Manager.
//!
//! Manages WebSocket connections to remote Jupyter kernels for real-time
//! code execution, streaming outputs, and status updates.
//! Supports direct connections and SOCKS5 proxy tunneling (SSH -D).

use std::collections::HashMap;
use std::sync::Arc;
use std::time::Duration;
use tauri::{AppHandle, Emitter};
use tokio::net::TcpStream;
use tokio::sync::{mpsc, RwLock};
use tokio::time::timeout;
use tokio_tungstenite::tungstenite::client::IntoClientRequest;
use tokio_tungstenite::tungstenite::handshake::client::Request;
use tokio_tungstenite::tungstenite::http::header::AUTHORIZATION;
use tokio_tungstenite::tungstenite::http::HeaderValue;
use tokio_tungstenite::tungstenite::protocol::Message;
use tokio_tungstenite::MaybeTlsStream;
use url::Url;

use crate::error::AppError;
use crate::jupyter::types::*;

const WS_CONNECT_TIMEOUT: Duration = Duration::from_secs(20);

use tokio::task::JoinHandle;

/// Active WebSocket connection to a Jupyter kernel session.
pub struct KernelConnection {
    /// Channel sender to send JSON string messages to the WebSocket write task.
    pub tx: mpsc::Sender<String>,
    /// Handle to the write task.
    pub write_task: JoinHandle<()>,
    /// Handle to the read task.
    pub read_task: JoinHandle<()>,
    /// Kernel ID.
    pub kernel_id: String,
    /// Server ID this kernel belongs to.
    pub server_id: String,
}

impl Drop for KernelConnection {
    fn drop(&mut self) {
        self.write_task.abort();
        self.read_task.abort();
    }
}

/// Global manager for kernel WebSocket connections.
pub struct KernelWsManager {
    /// Active connections keyed by `kernel_id`.
    connections: Arc<RwLock<HashMap<String, KernelConnection>>>,
    /// Broadcast channels for subscribers (like Agent tool execution) keyed by `kernel_id`.
    listeners: Arc<RwLock<HashMap<String, tokio::sync::broadcast::Sender<serde_json::Value>>>>,
}

impl KernelWsManager {
    /// Create a new KernelWsManager.
    pub fn new() -> Self {
        Self {
            connections: Arc::new(RwLock::new(HashMap::new())),
            listeners: Arc::new(RwLock::new(HashMap::new())),
        }
    }

    /// Subscribe to real-time JSON messages from a kernel WebSocket.
    pub async fn subscribe(
        &self,
        kernel_id: &str,
    ) -> tokio::sync::broadcast::Receiver<serde_json::Value> {
        let mut listeners = self.listeners.write().await;
        let tx = listeners.entry(kernel_id.to_string()).or_insert_with(|| {
            let (tx, _) = tokio::sync::broadcast::channel(100);
            tx
        });
        tx.subscribe()
    }

    /// Verify that a kernel WebSocket is connected to the expected server.
    pub async fn is_connected_to_server(&self, kernel_id: &str, server_id: &str) -> bool {
        self.connections
            .read()
            .await
            .get(kernel_id)
            .map(|connection| connection.server_id == server_id)
            .unwrap_or(false)
    }

    /// Connect to a kernel's WebSocket channel and start read/write tasks.
    pub async fn connect(
        &self,
        app: AppHandle,
        config: &JupyterServerConfig,
        kernel_id: &str,
        ws_url: &str,
    ) -> Result<(), AppError> {
        // If already connected, disconnect first
        self.disconnect(kernel_id).await;

        log::info!(
            "[KernelWS] Connecting kernel {} to WebSocket URL: {}",
            kernel_id,
            ws_url
        );

        let url = Url::parse(ws_url)
            .map_err(|e| AppError::JupyterConnection(format!("Invalid WebSocket URL: {}", e)))?;

        // Connect WebSocket (with optional SOCKS5 proxy support)
        let ws_stream = connect_ws_stream(&url, config).await?;
        log::info!("[KernelWS] WebSocket connected for kernel {}", kernel_id);

        let (mut write_half, mut read_half) = futures_util::StreamExt::split(ws_stream);

        // Create channel for sending messages from Tauri commands to the WebSocket
        let (tx, mut rx) = mpsc::channel::<String>(100);

        // Will insert connection in manager after spawning tasks

        // Emit connected status event
        let _ = app.emit(
            "kernel:status",
            serde_json::json!({
                "kernel_id": kernel_id,
                "status": "connected",
            }),
        );

        let k_id_write = kernel_id.to_string();
        let app_write = app.clone();

        // Spawn Write Task: Reads from mpsc rx and sends to WebSocket write_half
        let write_task = tokio::spawn(async move {
            use futures_util::SinkExt;
            while let Some(msg_str) = rx.recv().await {
                log::debug!(
                    "[KernelWS] Sending to kernel {}: {} bytes",
                    k_id_write,
                    msg_str.len()
                );
                if let Err(e) = write_half.send(Message::Text(msg_str.into())).await {
                    log::error!(
                        "[KernelWS] Error sending message to kernel {}: {}",
                        k_id_write,
                        e
                    );
                    break;
                }
            }
            // Send close frame to cleanly terminate the read task
            let _ = write_half.send(Message::Close(None)).await;
            log::info!("[KernelWS] Write task ended for kernel {}", k_id_write);
            let _ = app_write.emit(
                "kernel:status",
                serde_json::json!({
                    "kernel_id": k_id_write,
                    "status": "disconnected",
                }),
            );
        });

        let k_id_read = kernel_id.to_string();
        let app_read = app.clone();
        let conns_ref = self.connections.clone();
        let listeners_ref = self.listeners.clone();

        // Spawn Read Task: Reads from WebSocket read_half and emits Tauri events
        let read_task = tokio::spawn(async move {
            use futures_util::StreamExt;
            log::info!("[KernelWS] Read task started for kernel {}", k_id_read);
            while let Some(msg_res) = read_half.next().await {
                match msg_res {
                    Ok(Message::Text(text)) => {
                        log::debug!(
                            "[KernelWS] Text msg from kernel {}: {} bytes",
                            k_id_read,
                            text.len()
                        );
                        // Try to parse as JSON or send as string
                        if let Ok(json_val) = serde_json::from_str::<serde_json::Value>(&text) {
                            let msg_type = json_val
                                .get("header")
                                .and_then(|h| h.get("msg_type"))
                                .and_then(|t| t.as_str())
                                .unwrap_or("unknown");
                            let parent_id = json_val
                                .get("parent_header")
                                .and_then(|h| h.get("msg_id"))
                                .and_then(|t| t.as_str())
                                .unwrap_or("");
                            log::info!(
                                "[KernelWS] Text JSON msg_type={} parent={} from kernel {}",
                                msg_type,
                                parent_id,
                                k_id_read
                            );
                            if let Some(tx) = listeners_ref.read().await.get(&k_id_read) {
                                let _ = tx.send(json_val.clone());
                            }
                            let _ = app_read.emit(
                                "kernel:msg",
                                serde_json::json!({
                                    "kernel_id": &k_id_read,
                                    "msg": json_val,
                                }),
                            );
                        } else {
                            log::warn!(
                                "[KernelWS] Non-JSON text from kernel {}: {}...",
                                k_id_read,
                                &text[..text.len().min(200)]
                            );
                            let _ = app_read.emit(
                                "kernel:msg",
                                serde_json::json!({
                                    "kernel_id": &k_id_read,
                                    "raw": text,
                                }),
                            );
                        }
                    }
                    Ok(Message::Binary(bin)) => {
                        log::debug!(
                            "[KernelWS] Binary msg from kernel {}: {} bytes",
                            k_id_read,
                            bin.len()
                        );
                        if let Some(json_val) = parse_jupyter_binary_msg(&bin) {
                            let msg_type = json_val
                                .get("header")
                                .and_then(|h| h.get("msg_type"))
                                .and_then(|t| t.as_str())
                                .unwrap_or("unknown");
                            let parent_id = json_val
                                .get("parent_header")
                                .and_then(|h| h.get("msg_id"))
                                .and_then(|t| t.as_str())
                                .unwrap_or("");
                            log::info!(
                                "[KernelWS] Binary parsed msg_type={} parent={} from kernel {}",
                                msg_type,
                                parent_id,
                                k_id_read
                            );
                            if let Some(tx) = listeners_ref.read().await.get(&k_id_read) {
                                let _ = tx.send(json_val.clone());
                            }
                            let _ = app_read.emit(
                                "kernel:msg",
                                serde_json::json!({
                                    "kernel_id": &k_id_read,
                                    "msg": json_val,
                                }),
                            );
                        } else {
                            log::warn!(
                                "[KernelWS] Failed to parse binary msg ({} bytes) from kernel {}. First 64 bytes: {:?}",
                                bin.len(), k_id_read, &bin[..bin.len().min(64)]
                            );
                            // Emit error to frontend so user sees feedback
                            let _ = app_read.emit("kernel:status", serde_json::json!({
                                "kernel_id": &k_id_read,
                                "status": "error",
                                "message": format!("Failed to parse binary message ({} bytes)", bin.len()),
                            }));
                        }
                    }
                    Ok(Message::Ping(_)) => {
                        log::trace!("[KernelWS] Ping from kernel {}", k_id_read);
                    }
                    Ok(Message::Pong(_)) => {
                        log::trace!("[KernelWS] Pong from kernel {}", k_id_read);
                    }
                    Ok(Message::Close(frame)) => {
                        log::info!(
                            "[KernelWS] WebSocket closed by kernel {}: {:?}",
                            k_id_read,
                            frame
                        );
                        break;
                    }
                    Err(e) => {
                        log::error!(
                            "[KernelWS] WebSocket read error from kernel {}: {}",
                            k_id_read,
                            e
                        );
                        let _ = app_read.emit(
                            "kernel:status",
                            serde_json::json!({
                                "kernel_id": &k_id_read,
                                "status": "error",
                                "message": format!("WebSocket error: {}", e),
                            }),
                        );
                        break;
                    }
                    _ => {
                        log::debug!("[KernelWS] Other message type from kernel {}", k_id_read);
                    }
                }
            }

            // Clean up connection on disconnect
            log::info!(
                "[KernelWS] Read task ended for kernel {}, cleaning up",
                k_id_read
            );
            let mut conns = conns_ref.write().await;
            conns.remove(&k_id_read);

            let _ = app_read.emit(
                "kernel:status",
                serde_json::json!({
                    "kernel_id": &k_id_read,
                    "status": "disconnected",
                }),
            );
        });

        // Store connection in manager with abort handles
        {
            let mut conns = self.connections.write().await;
            conns.insert(
                kernel_id.to_string(),
                KernelConnection {
                    tx,
                    write_task,
                    read_task,
                    kernel_id: kernel_id.to_string(),
                    server_id: config.id.clone(),
                },
            );
        }

        Ok(())
    }

    /// Send a JSON message string to an active kernel WebSocket.
    pub async fn send_message(&self, kernel_id: &str, msg_str: String) -> Result<(), AppError> {
        let conns = self.connections.read().await;
        if let Some(conn) = conns.get(kernel_id) {
            conn.tx
                .send(msg_str)
                .await
                .map_err(|e| AppError::WebSocket(format!("Failed to send to channel: {}", e)))?;
            Ok(())
        } else {
            Err(AppError::Kernel(format!(
                "Kernel WebSocket not connected: {}",
                kernel_id
            )))
        }
    }

    /// Disconnect from a kernel WebSocket.
    pub async fn disconnect(&self, kernel_id: &str) {
        let mut conns = self.connections.write().await;
        if let Some(conn) = conns.remove(kernel_id) {
            // Dropping conn.tx will close the receiver in the write task,
            // which will terminate the write half and close the WebSocket.
            drop(conn);
        }
    }

    /// Check if a kernel is currently connected via WebSocket.
    pub async fn is_connected(&self, kernel_id: &str) -> bool {
        let conns = self.connections.read().await;
        conns.contains_key(kernel_id)
    }

    /// Get list of all currently connected kernel IDs.
    pub async fn get_connected_kernel_ids(&self) -> Vec<String> {
        let conns = self.connections.read().await;
        conns.keys().cloned().collect()
    }
}

impl Default for KernelWsManager {
    fn default() -> Self {
        Self::new()
    }
}

/// Parse a Jupyter kernel WebSocket binary message frame.
///
/// Jupyter Server v1 protocol (`v1.kernel.websocket.jupyter.org`) binary layout:
///   [offset_number (8B u64 LE)] [offset_0 (8B u64 LE)] ... [offset_N-1 (8B u64 LE)]
///   [msg_json_bytes] [buffer_0_bytes] [buffer_1_bytes] ...
///
/// offset_number = N (number of offsets following)
/// offset_0 = byte position where JSON message starts (should be 8 + N*8)
/// offset_1 = byte position where first binary buffer starts (also end of JSON)
/// ...
fn parse_jupyter_binary_msg(bin: &[u8]) -> Option<serde_json::Value> {
    if bin.len() < 8 {
        log::debug!("[BinaryParse] Too short: {} bytes", bin.len());
        return None;
    }

    // Try v1 protocol: first 8 bytes = offset_number (u64 LE)
    let offset_number = u64::from_le_bytes(bin[0..8].try_into().ok()?) as usize;

    // Sanity check: offset_number should be a small number (typically 1 for no buffers)
    // If it's unreasonably large, this might not be v1 binary framing
    if offset_number == 0 || offset_number > 1000 {
        log::debug!(
            "[BinaryParse] offset_number={} seems invalid, trying raw JSON",
            offset_number
        );
        // Fallback: try parsing the entire binary as raw UTF-8 JSON (some servers send JSON as binary)
        return serde_json::from_slice::<serde_json::Value>(bin).ok();
    }

    let header_size = 8 + offset_number * 8;
    if bin.len() < header_size {
        log::debug!(
            "[BinaryParse] Not enough bytes for offset table: need {}, have {}",
            header_size,
            bin.len()
        );
        // Fallback: try raw JSON
        return serde_json::from_slice::<serde_json::Value>(bin).ok();
    }

    let mut offsets = Vec::with_capacity(offset_number);
    for i in 0..offset_number {
        let start = 8 + i * 8;
        let end = start + 8;
        offsets.push(u64::from_le_bytes(bin[start..end].try_into().ok()?) as usize);
    }

    if offsets.iter().any(|offset| *offset > bin.len())
        || offsets.windows(2).any(|pair| pair[0] > pair[1])
    {
        log::debug!(
            "[BinaryParse] Invalid offsets {:?} for bin_len={}",
            offsets,
            bin.len()
        );
        return None;
    }

    let offset_0 = offsets[0];

    if offset_0 != header_size {
        log::debug!(
            "[BinaryParse] offset_0={} != header_size={}, trying raw JSON",
            offset_0,
            header_size
        );
        // Possibly not v1 format; try raw JSON
        return serde_json::from_slice::<serde_json::Value>(bin).ok();
    }

    // Jupyter Server v1 binary protocol sends:
    // channel, header, parent_header, metadata, content, then optional buffers.
    // The last offset is the end of content when there are no extra buffers.
    if offset_number >= 6 {
        let channel = std::str::from_utf8(&bin[offsets[0]..offsets[1]]).ok()?;
        let header =
            serde_json::from_slice::<serde_json::Value>(&bin[offsets[1]..offsets[2]]).ok()?;
        let parent_header =
            serde_json::from_slice::<serde_json::Value>(&bin[offsets[2]..offsets[3]]).ok()?;
        let metadata =
            serde_json::from_slice::<serde_json::Value>(&bin[offsets[3]..offsets[4]]).ok()?;
        let content =
            serde_json::from_slice::<serde_json::Value>(&bin[offsets[4]..offsets[5]]).ok()?;

        return Some(serde_json::json!({
            "channel": channel,
            "header": header,
            "parent_header": parent_header,
            "metadata": metadata,
            "content": content,
        }));
    }

    let end_offset = if offset_number > 1 {
        offsets[1]
    } else {
        bin.len()
    };

    if offset_0 > end_offset || end_offset > bin.len() {
        log::debug!(
            "[BinaryParse] Invalid range: offset_0={} end_offset={} bin_len={}",
            offset_0,
            end_offset,
            bin.len()
        );
        return None;
    }

    let json_slice = &bin[offset_0..end_offset];
    log::debug!(
        "[BinaryParse] Parsing JSON from bytes {}..{} ({} bytes)",
        offset_0,
        end_offset,
        json_slice.len()
    );

    match serde_json::from_slice::<serde_json::Value>(json_slice) {
        Ok(val) => Some(val),
        Err(e) => {
            log::warn!(
                "[BinaryParse] JSON parse failed: {}. Trying raw JSON fallback.",
                e
            );
            // Last resort: try parsing entire binary as JSON
            serde_json::from_slice::<serde_json::Value>(bin).ok()
        }
    }
}

/// Helper function to connect WebSocket with optional SOCKS5 proxy support.
/// For `wss://` URLs through SOCKS5, performs TLS handshake over the proxied TCP stream.
pub(crate) async fn connect_ws_stream(
    url: &Url,
    config: &JupyterServerConfig,
) -> Result<tokio_tungstenite::WebSocketStream<MaybeTlsStream<TcpStream>>, AppError> {
    if let Some(proxy) = &config.proxy {
        match proxy.proxy_type {
            ProxyType::Socks5 => {
                let target_host = url
                    .host_str()
                    .ok_or_else(|| AppError::JupyterConnection("URL has no host".to_string()))?;
                let target_port = url.port_or_known_default().unwrap_or(80);

                let proxy_addr = (proxy.host.as_str(), proxy.port);
                let target_addr = (target_host, target_port);

                log::info!(
                    "[KernelWS] Connecting WebSocket to {}:{} via SOCKS5 proxy {}:{}",
                    target_host,
                    target_port,
                    proxy.host,
                    proxy.port
                );

                // Connect through SOCKS5 proxy
                let socks_stream = if let (Some(user), Some(pass)) =
                    (&proxy.username, &proxy.password)
                {
                    timeout(
                        WS_CONNECT_TIMEOUT,
                        tokio_socks::tcp::Socks5Stream::connect_with_password(
                            proxy_addr,
                            target_addr,
                            user.as_str(),
                            pass.as_str(),
                        ),
                    )
                    .await
                    .map_err(|_| {
                        AppError::Proxy(format!(
                            "SOCKS5 auth connect timed out after {}s",
                            WS_CONNECT_TIMEOUT.as_secs()
                        ))
                    })?
                    .map_err(|e| AppError::Proxy(format!("SOCKS5 auth connect failed: {}", e)))?
                } else {
                    timeout(
                        WS_CONNECT_TIMEOUT,
                        tokio_socks::tcp::Socks5Stream::connect(proxy_addr, target_addr),
                    )
                    .await
                    .map_err(|_| {
                        AppError::Proxy(format!(
                            "SOCKS5 connect timed out after {}s",
                            WS_CONNECT_TIMEOUT.as_secs()
                        ))
                    })?
                    .map_err(|e| AppError::Proxy(format!("SOCKS5 connect failed: {}", e)))?
                };

                let tcp_stream = socks_stream.into_inner();

                // For wss:// URLs, perform TLS handshake over the SOCKS5-proxied TCP stream
                if url.scheme() == "wss" {
                    log::info!(
                        "[KernelWS] Performing TLS handshake for wss:// over SOCKS5 to {}",
                        target_host
                    );
                    let tls_connector = native_tls::TlsConnector::new().map_err(|e| {
                        AppError::WebSocket(format!("TLS connector creation failed: {}", e))
                    })?;
                    let tls_connector = tokio_native_tls::TlsConnector::from(tls_connector);
                    let tls_stream = timeout(
                        WS_CONNECT_TIMEOUT,
                        tls_connector.connect(target_host, tcp_stream),
                    )
                    .await
                    .map_err(|_| {
                        AppError::WebSocket(format!(
                            "TLS handshake timed out after {}s via SOCKS5 to {}",
                            WS_CONNECT_TIMEOUT.as_secs(),
                            target_host
                        ))
                    })?
                    .map_err(|e| {
                        AppError::WebSocket(format!("TLS handshake failed via SOCKS5: {}", e))
                    })?;

                    log::info!(
                        "[KernelWS] TLS handshake completed for {}; starting WebSocket handshake",
                        target_host
                    );
                    let stream = MaybeTlsStream::NativeTls(tls_stream);
                    let request = build_ws_client_request(url, config)?;

                    let (ws_stream, _) = timeout(
                        WS_CONNECT_TIMEOUT,
                        tokio_tungstenite::client_async(request, stream),
                    )
                    .await
                    .map_err(|_| {
                        AppError::WebSocket(format!(
                            "WebSocket handshake timed out after {}s via SOCKS5+TLS",
                            WS_CONNECT_TIMEOUT.as_secs()
                        ))
                    })?
                    .map_err(|e| {
                        AppError::WebSocket(format!(
                            "WebSocket handshake failed via SOCKS5+TLS: {}",
                            e
                        ))
                    })?;

                    log::info!("[KernelWS] WebSocket connected via SOCKS5+TLS");
                    Ok(ws_stream)
                } else {
                    let stream = MaybeTlsStream::Plain(tcp_stream);
                    let request = build_ws_client_request(url, config)?;

                    let (ws_stream, _) = timeout(
                        WS_CONNECT_TIMEOUT,
                        tokio_tungstenite::client_async(request, stream),
                    )
                    .await
                    .map_err(|_| {
                        AppError::WebSocket(format!(
                            "WebSocket handshake timed out after {}s via SOCKS5",
                            WS_CONNECT_TIMEOUT.as_secs()
                        ))
                    })?
                    .map_err(|e| {
                        AppError::WebSocket(format!("WebSocket handshake failed via SOCKS5: {}", e))
                    })?;

                    log::info!("[KernelWS] WebSocket connected via SOCKS5 (plain)");
                    Ok(ws_stream)
                }
            }
            _ => {
                // For HTTP/HTTPS proxies or direct, fallback to default connect_async
                let request = build_ws_client_request(url, config)?;
                let (ws_stream, _) = timeout(
                    WS_CONNECT_TIMEOUT,
                    tokio_tungstenite::connect_async(request),
                )
                .await
                .map_err(|_| {
                    AppError::WebSocket(format!(
                        "WebSocket connection timed out after {}s",
                        WS_CONNECT_TIMEOUT.as_secs()
                    ))
                })?
                .map_err(|e| AppError::WebSocket(format!("WebSocket connection failed: {}", e)))?;
                Ok(ws_stream)
            }
        }
    } else {
        // Direct connection (connect_async handles TLS automatically for wss://)
        let request = build_ws_client_request(url, config)?;
        let (ws_stream, _) = timeout(
            WS_CONNECT_TIMEOUT,
            tokio_tungstenite::connect_async(request),
        )
        .await
        .map_err(|_| {
            AppError::WebSocket(format!(
                "WebSocket connection timed out after {}s",
                WS_CONNECT_TIMEOUT.as_secs()
            ))
        })?
        .map_err(|e| AppError::WebSocket(format!("WebSocket connection failed: {}", e)))?;
        Ok(ws_stream)
    }
}

fn build_ws_client_request(url: &Url, config: &JupyterServerConfig) -> Result<Request, AppError> {
    let mut request = url
        .as_str()
        .into_client_request()
        .map_err(|e| AppError::WebSocket(format!("Failed to build WebSocket request: {}", e)))?;

    if let Some(token) = &config.token {
        let auth_value = HeaderValue::from_str(&format!("token {}", token))
            .map_err(|e| AppError::WebSocket(format!("Invalid WebSocket auth header: {}", e)))?;
        request.headers_mut().insert(AUTHORIZATION, auth_value);
    }

    Ok(request)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn build_ws_client_request_includes_jupyter_auth_without_v1_subprotocol() {
        let url = Url::parse(
            "wss://ius16.dataincity.com/user/wlx/api/kernels/kernel-id/channels?token=secret-token",
        )
        .unwrap();
        let config = JupyterServerConfig {
            id: "server".to_string(),
            name: "Server".to_string(),
            base_url: "https://ius16.dataincity.com/user/wlx".to_string(),
            token: Some("secret-token".to_string()),
            proxy: None,
        };

        let request = build_ws_client_request(&url, &config).unwrap();

        assert_eq!(
            request
                .headers()
                .get("authorization")
                .and_then(|value| value.to_str().ok()),
            Some("token secret-token")
        );
        assert_eq!(
            request
                .headers()
                .get("sec-websocket-protocol")
                .and_then(|value| value.to_str().ok()),
            None
        );
    }

    #[test]
    fn parse_jupyter_v1_binary_message_combines_json_parts() {
        let header = br#"{"msg_id":"msg-1","msg_type":"status"}"#;
        let parent_header = br#"{"msg_id":"parent-1"}"#;
        let metadata = br#"{}"#;
        let content = br#"{"execution_state":"idle"}"#;
        let parts: [&[u8]; 5] = [b"iopub", header, parent_header, metadata, content];

        let offset_count = parts.len() + 1;
        let mut next_offset = 8 + offset_count * 8;
        let mut payload = Vec::new();
        payload.extend_from_slice(&(offset_count as u64).to_le_bytes());
        for part in parts {
            payload.extend_from_slice(&(next_offset as u64).to_le_bytes());
            next_offset += part.len();
        }
        payload.extend_from_slice(&(next_offset as u64).to_le_bytes());
        for part in parts {
            payload.extend_from_slice(part);
        }

        let parsed = parse_jupyter_binary_msg(&payload).unwrap();

        assert_eq!(parsed["channel"], "iopub");
        assert_eq!(parsed["header"]["msg_type"], "status");
        assert_eq!(parsed["parent_header"]["msg_id"], "parent-1");
        assert_eq!(parsed["content"]["execution_state"], "idle");
    }
}
