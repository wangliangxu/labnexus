//! LabNexus — Jupyter-related type definitions.
//!
//! Types for Notebook documents, cells, outputs, server connections,
//! and the Jupyter messaging protocol.

use chrono::Utc;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

// ─── Server & Connection ───────────────────────────────────────────────

/// Configuration for connecting to a remote Jupyter server.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct JupyterServerConfig {
    /// Unique identifier for this server connection.
    pub id: String,
    /// Display name for the connection.
    pub name: String,
    /// Base URL of the Jupyter server (e.g., "https://jupyter.example.com:8888").
    pub base_url: String,
    /// Authentication token.
    pub token: Option<String>,
    /// Optional proxy configuration.
    pub proxy: Option<ProxyConfig>,
}

/// Request for logging into a JupyterHub/TLJH server with username and password.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct JupyterHubLoginRequest {
    pub id: Option<String>,
    pub url: String,
    pub username: String,
    pub password: String,
    pub proxy: Option<ProxyConfig>,
    pub name: Option<String>,
}

/// Proxy configuration for tunneled connections.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProxyConfig {
    /// Proxy type: "socks5" or "http".
    pub proxy_type: ProxyType,
    /// Proxy host (e.g., "127.0.0.1").
    pub host: String,
    /// Proxy port (e.g., 1080 for SOCKS5 via SSH -D).
    pub port: u16,
    /// Optional proxy authentication username.
    pub username: Option<String>,
    /// Optional proxy authentication password.
    pub password: Option<String>,
}

/// Supported proxy types.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ProxyType {
    Socks5,
    Http,
    Https,
}

/// Information returned by the Jupyter server API.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ServerInfo {
    pub version: String,
    #[serde(default)]
    pub base_url: String,
    #[serde(default)]
    pub hostname: String,
    #[serde(default)]
    pub pid: i64,
}

/// Connection status for a Jupyter server.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum ConnectionStatus {
    Disconnected,
    Connecting,
    Connected,
    Reconnecting,
    Error,
}

/// A managed server connection with runtime state.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ServerConnection {
    pub config: JupyterServerConfig,
    pub status: ConnectionStatus,
    pub server_info: Option<ServerInfo>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error_message: Option<String>,
}

// ─── Contents API ──────────────────────────────────────────────────────

/// Content item returned by the Jupyter Contents API.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ContentItem {
    pub name: String,
    pub path: String,
    #[serde(rename(serialize = "content_type", deserialize = "type"))]
    pub content_type: ContentType,
    #[serde(default)]
    pub writable: bool,
    pub created: Option<String>,
    pub last_modified: Option<String>,
    #[serde(default)]
    pub mimetype: Option<String>,
    #[serde(default)]
    pub format: Option<String>,
    /// For files: the file content. For directories: list of child items.
    #[serde(default)]
    pub content: Option<serde_json::Value>,
    /// File size in bytes (if available).
    #[serde(default)]
    pub size: Option<u64>,
}

/// Content types in the Jupyter file system.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum ContentType {
    Directory,
    File,
    Notebook,
}

// ─── Notebook Document ─────────────────────────────────────────────────

/// A Jupyter Notebook document (nbformat v4).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NotebookDocument {
    pub nbformat: u32,
    pub nbformat_minor: u32,
    pub metadata: NotebookMetadata,
    pub cells: Vec<Cell>,
}

/// Notebook-level metadata.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NotebookMetadata {
    #[serde(default)]
    pub kernelspec: Option<KernelSpec>,
    #[serde(default)]
    pub language_info: Option<LanguageInfo>,
    /// Catch-all for additional metadata fields.
    #[serde(flatten)]
    pub extra: HashMap<String, serde_json::Value>,
}

/// Kernel specification embedded in notebook metadata.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct KernelSpec {
    pub name: String,
    pub display_name: String,
    #[serde(default)]
    pub language: Option<String>,
}

/// Language information embedded in notebook metadata.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LanguageInfo {
    pub name: String,
    #[serde(default)]
    pub version: Option<String>,
    #[serde(default)]
    pub mimetype: Option<String>,
    #[serde(default)]
    pub file_extension: Option<String>,
}

// ─── Cells ─────────────────────────────────────────────────────────────

/// A single cell in a Notebook.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Cell {
    /// Cell type: code, markdown, or raw.
    pub cell_type: CellType,
    /// Source code/text of the cell (lines joined by newlines).
    pub source: String,
    /// Cell-level metadata.
    #[serde(default)]
    pub metadata: CellMetadata,
    /// Unique cell ID (nbformat v4.5+).
    #[serde(default)]
    pub id: Option<String>,
    /// Execution count (code cells only).
    #[serde(default)]
    pub execution_count: Option<u64>,
    /// Cell outputs (code cells only).
    #[serde(default)]
    pub outputs: Vec<CellOutput>,
}

/// Cell types.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum CellType {
    Code,
    Markdown,
    Raw,
}

/// Cell-level metadata.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct CellMetadata {
    #[serde(default)]
    pub collapsed: Option<bool>,
    #[serde(default)]
    pub scrolled: Option<serde_json::Value>,
    /// Catch-all for additional metadata fields.
    #[serde(flatten)]
    pub extra: HashMap<String, serde_json::Value>,
}

// ─── Cell Outputs ──────────────────────────────────────────────────────

/// Output from a code cell execution.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "output_type")]
pub enum CellOutput {
    /// Standard output/error stream.
    #[serde(rename = "stream")]
    Stream {
        name: String, // "stdout" or "stderr"
        text: StringOrVec,
    },
    /// Rich display data.
    #[serde(rename = "display_data")]
    DisplayData {
        data: HashMap<String, serde_json::Value>,
        #[serde(default)]
        metadata: HashMap<String, serde_json::Value>,
    },
    /// Result of code execution (with execution_count).
    #[serde(rename = "execute_result")]
    ExecuteResult {
        execution_count: u64,
        data: HashMap<String, serde_json::Value>,
        #[serde(default)]
        metadata: HashMap<String, serde_json::Value>,
    },
    /// Error traceback.
    #[serde(rename = "error")]
    Error {
        ename: String,
        evalue: String,
        traceback: Vec<String>,
    },
}

/// Jupyter stores text as either a string or a list of strings.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(untagged)]
pub enum StringOrVec {
    String(String),
    Vec(Vec<String>),
}

impl StringOrVec {
    pub fn as_string(&self) -> String {
        match self {
            StringOrVec::String(s) => s.clone(),
            StringOrVec::Vec(v) => v.join(""),
        }
    }
}

// ─── Kernel & Session ──────────────────────────────────────────────────

/// Kernel information from the Jupyter API.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct KernelInfo {
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub last_activity: Option<String>,
    #[serde(default)]
    pub execution_state: Option<String>,
    #[serde(default)]
    pub connections: Option<u32>,
}

/// Session information from the Jupyter API.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SessionInfo {
    pub id: String,
    pub path: String,
    pub name: String,
    #[serde(rename = "type")]
    pub session_type: String,
    pub kernel: KernelInfo,
}

/// Request body for creating a new session.
#[derive(Debug, Serialize)]
pub struct CreateSessionRequest {
    pub path: String,
    pub name: String,
    #[serde(rename = "type")]
    pub session_type: String,
    pub kernel: CreateKernelRequest,
}

/// Kernel part of a session creation request.
#[derive(Debug, Serialize)]
pub struct CreateKernelRequest {
    pub name: String,
}

/// Terminal session information from the Jupyter API.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TerminalInfo {
    pub name: String,
}

// ─── Jupyter Wire Protocol ─────────────────────────────────────────────

/// A message in the Jupyter messaging protocol (wire format v5.3+).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct JupyterMessage {
    pub header: MessageHeader,
    #[serde(default)]
    pub parent_header: Option<MessageHeader>,
    #[serde(default)]
    pub metadata: serde_json::Value,
    pub content: serde_json::Value,
    #[serde(default)]
    pub buffers: Vec<Vec<u8>>,
    /// Channel this message was received on or should be sent to.
    #[serde(default)]
    pub channel: Option<String>,
}

/// Header of a Jupyter wire protocol message.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MessageHeader {
    pub msg_id: String,
    pub msg_type: String,
    pub username: String,
    pub session: String,
    #[serde(default)]
    pub date: Option<String>,
    #[serde(default)]
    pub version: Option<String>,
}

impl JupyterMessage {
    /// Create a new execute_request message.
    pub fn execute_request(code: &str, session_id: &str) -> Self {
        JupyterMessage {
            header: MessageHeader {
                msg_id: uuid::Uuid::new_v4().to_string(),
                msg_type: "execute_request".to_string(),
                username: "labnexus".to_string(),
                session: session_id.to_string(),
                date: Some(Utc::now().to_rfc3339()),
                version: Some("5.3".to_string()),
            },
            parent_header: None,
            metadata: serde_json::json!({}),
            content: serde_json::json!({
                "code": code,
                "silent": false,
                "store_history": true,
                "user_expressions": {},
                "allow_stdin": false,
                "stop_on_error": true
            }),
            buffers: vec![],
            channel: Some("shell".to_string()),
        }
    }
}

// ─── Kernel Execution State ────────────────────────────────────────────

/// Kernel execution status.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum KernelStatus {
    Idle,
    Busy,
    Starting,
    Restarting,
    Dead,
    Unknown,
}

impl Default for KernelStatus {
    fn default() -> Self {
        KernelStatus::Unknown
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn content_item_deserializes_jupyter_type_and_serializes_content_type_for_frontend() {
        let item: ContentItem = serde_json::from_value(serde_json::json!({
            "name": "notebooks",
            "path": "notebooks",
            "type": "directory",
            "writable": true,
            "content": []
        }))
        .expect("Jupyter Contents API item should deserialize from type");

        assert_eq!(item.content_type, ContentType::Directory);

        let serialized = serde_json::to_value(item).expect("content item should serialize");
        assert_eq!(serialized["content_type"], "directory");
        assert!(serialized.get("type").is_none());
    }
}
