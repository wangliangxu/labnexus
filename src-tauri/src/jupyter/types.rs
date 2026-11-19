//! LabNexus — Jupyter-related type definitions.
//!
//! Types for Notebook documents, cells, outputs, server connections,
//! and the Jupyter messaging protocol.

use serde::ser::SerializeStruct;
use serde::{Deserialize, Serialize};

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
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub remote_launch: Option<RemoteJupyterLaunch>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct RemoteJupyterLaunch {
    pub alias: String,
    pub python: String,
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
    /// Transport used to reach the Jupyter server.
    pub proxy_type: ProxyType,
    /// Proxy host, or an OpenSSH host alias in SSH mode.
    pub host: String,
    /// Proxy port for manual proxies. OpenSSH determines its server port.
    #[serde(default)]
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
    Ssh,
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
#[derive(Debug, Clone, Deserialize)]
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

impl Serialize for ContentItem {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        let content = if self.content_type == ContentType::Directory {
            normalize_directory_content(&self.content)
        } else {
            self.content.clone()
        };

        let mut state = serializer.serialize_struct("ContentItem", 10)?;
        state.serialize_field("name", &self.name)?;
        state.serialize_field("path", &self.path)?;
        state.serialize_field("content_type", &self.content_type)?;
        state.serialize_field("writable", &self.writable)?;
        state.serialize_field("created", &self.created)?;
        state.serialize_field("last_modified", &self.last_modified)?;
        state.serialize_field("mimetype", &self.mimetype)?;
        state.serialize_field("format", &self.format)?;
        state.serialize_field("content", &content)?;
        state.serialize_field("size", &self.size)?;
        state.end()
    }
}

fn normalize_directory_content(content: &Option<serde_json::Value>) -> Option<serde_json::Value> {
    match content {
        Some(serde_json::Value::Array(children)) => Some(serde_json::Value::Array(
            children.iter().map(normalize_directory_child).collect(),
        )),
        _ => content.clone(),
    }
}

fn normalize_directory_child(child: &serde_json::Value) -> serde_json::Value {
    let serde_json::Value::Object(raw_child) = child else {
        return child.clone();
    };

    let mut normalized = raw_child.clone();
    if let Some(content_type) = normalized.remove("type") {
        normalized.insert("content_type".to_string(), content_type);
    }

    if normalized
        .get("content_type")
        .and_then(|value| value.as_str())
        == Some("directory")
    {
        if let Some(child_content) = normalized.get("content") {
            let normalized_content = match child_content {
                serde_json::Value::Array(grandchildren) => serde_json::Value::Array(
                    grandchildren
                        .iter()
                        .map(normalize_directory_child)
                        .collect(),
                ),
                _ => child_content.clone(),
            };
            normalized.insert("content".to_string(), normalized_content);
        }
    }

    serde_json::Value::Object(normalized)
}

/// Content types in the Jupyter file system.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum ContentType {
    Directory,
    File,
    Notebook,
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

    #[test]
    fn directory_content_children_serialize_content_type_for_frontend() {
        let item: ContentItem = serde_json::from_value(serde_json::json!({
            "name": "",
            "path": "",
            "type": "directory",
            "writable": true,
            "content": [
                {
                    "name": "notebooks",
                    "path": "notebooks",
                    "type": "directory",
                    "writable": true,
                    "content": []
                },
                {
                    "name": "analysis.ipynb",
                    "path": "analysis.ipynb",
                    "type": "notebook",
                    "writable": true,
                    "content": null
                }
            ]
        }))
        .expect("directory item should deserialize");

        let serialized = serde_json::to_value(item).expect("directory item should serialize");
        let children = serialized["content"]
            .as_array()
            .expect("directory content should serialize as an array");

        assert_eq!(children[0]["content_type"], "directory");
        assert!(children[0].get("type").is_none());
        assert_eq!(children[1]["content_type"], "notebook");
        assert!(children[1].get("type").is_none());
    }
}
