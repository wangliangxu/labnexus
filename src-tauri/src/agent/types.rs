//! LabNexus — Agent data types and communication structures.

use serde::{Deserialize, Serialize};

/// Represents a chat message in the Agent ReAct loop or conversation history.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AgentMessage {
    pub id: String,
    pub role: String, // "system", "user", "assistant", "tool"
    pub content: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reasoning_content: Option<String>,
    /// Exact Responses items for stateless continuation, scoped to their origin.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub response_replay: Option<ResponseReplay>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tool_calls: Option<Vec<ToolCall>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tool_call_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
    pub timestamp: String,
}

impl AgentMessage {
    pub fn system(content: impl Into<String>) -> Self {
        Self {
            id: uuid::Uuid::new_v4().to_string(),
            role: "system".to_string(),
            content: content.into(),
            reasoning_content: None,
            response_replay: None,
            tool_calls: None,
            tool_call_id: None,
            name: None,
            timestamp: chrono::Utc::now().to_rfc3339(),
        }
    }

    pub fn user(content: impl Into<String>) -> Self {
        Self {
            id: uuid::Uuid::new_v4().to_string(),
            role: "user".to_string(),
            content: content.into(),
            reasoning_content: None,
            response_replay: None,
            tool_calls: None,
            tool_call_id: None,
            name: None,
            timestamp: chrono::Utc::now().to_rfc3339(),
        }
    }

    pub fn assistant(content: impl Into<String>) -> Self {
        Self {
            id: uuid::Uuid::new_v4().to_string(),
            role: "assistant".to_string(),
            content: content.into(),
            reasoning_content: None,
            response_replay: None,
            tool_calls: None,
            tool_call_id: None,
            name: None,
            timestamp: chrono::Utc::now().to_rfc3339(),
        }
    }

    pub fn assistant_with_tools(content: impl Into<String>, tool_calls: Vec<ToolCall>) -> Self {
        Self {
            id: uuid::Uuid::new_v4().to_string(),
            role: "assistant".to_string(),
            content: content.into(),
            reasoning_content: None,
            response_replay: None,
            tool_calls: Some(tool_calls),
            tool_call_id: None,
            name: None,
            timestamp: chrono::Utc::now().to_rfc3339(),
        }
    }

    pub fn tool_result(
        tool_call_id: impl Into<String>,
        name: impl Into<String>,
        output: impl Into<String>,
    ) -> Self {
        Self {
            id: uuid::Uuid::new_v4().to_string(),
            role: "tool".to_string(),
            content: output.into(),
            reasoning_content: None,
            response_replay: None,
            tool_calls: None,
            tool_call_id: Some(tool_call_id.into()),
            name: Some(name.into()),
            timestamp: chrono::Utc::now().to_rfc3339(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ResponseReplay {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub auth_scope: Option<String>,
    pub model: String,
    pub endpoint: String,
    pub output: Vec<serde_json::Value>,
}

/// A tool call requested by the LLM.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ToolCall {
    pub id: String,
    #[serde(rename = "type")]
    pub call_type: String, // Always "function"
    pub function: FunctionCall,
}

/// The function specification within a tool call.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FunctionCall {
    pub name: String,
    pub arguments: String, // JSON string of arguments
}

/// MCP/OpenAI style tool definition sent to LLM providers.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ToolDefinition {
    #[serde(rename = "type")]
    pub tool_type: String, // Always "function"
    pub function: FunctionDefinition,
}

/// Function schema inside a ToolDefinition.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FunctionDefinition {
    pub name: String,
    pub description: String,
    pub parameters: serde_json::Value,
}

/// Jupyter-aware context optionally attached to chat messages.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct AgentChatContext {
    pub server_id: Option<String>,
    pub notebook_path: Option<String>,
    pub session_id: Option<String>,
    pub kernel_id: Option<String>,
    pub active_cell_id: Option<String>,
    pub active_cell_index: Option<usize>,
    pub active_cell_code: Option<String>,
    pub kernel_status: Option<String>,
    pub last_error: Option<String>,
}

/// Event payload emitted via Tauri IPC: `agent:stream`.
#[derive(Debug, Clone, Serialize)]
pub struct AgentStreamEvent {
    pub session_id: String,
    pub run_id: String,
    pub chunk_type: String, // "thought", "answer", "done", "error"
    pub content: String,
}

/// Event payload emitted via Tauri IPC: `agent:tool_call`.
#[derive(Debug, Clone, Serialize)]
pub struct AgentToolCallEvent {
    pub session_id: String,
    pub run_id: String,
    pub tool_call_id: String,
    pub tool_name: String,
    pub arguments: serde_json::Value,
    pub status: String, // "pending", "running", "completed", "error", "requires_confirmation"
    pub result: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub risk_level: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub confirmation_reason: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub allow_session: Option<bool>,
}
