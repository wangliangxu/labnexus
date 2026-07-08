//! LabNexus — Unified error types for the application.

use serde::Serialize;

/// Application-wide error type.
#[derive(Debug, thiserror::Error)]
pub enum AppError {
    #[error("Jupyter connection error: {0}")]
    JupyterConnection(String),

    #[error("Jupyter API error: {status} — {message}")]
    JupyterApi { status: u16, message: String },

    #[error("Jupyter authentication failed: {0}")]
    JupyterAuth(String),

    #[error("Kernel error: {0}")]
    Kernel(String),

    #[error("WebSocket error: {0}")]
    WebSocket(String),

    #[error("Proxy error: {0}")]
    Proxy(String),

    #[error("Agent error: {0}")]
    Agent(String),

    #[error("Serialization error: {0}")]
    Serialization(String),

    #[error("Not connected to any Jupyter server")]
    NotConnected,

    #[error("Server not found: {0}")]
    ServerNotFound(String),

    #[error("IO error: {0}")]
    Io(#[from] std::io::Error),

    #[error("{0}")]
    Other(String),
}

// Tauri requires errors to be serializable
impl Serialize for AppError {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        #[derive(Serialize)]
        struct ErrorPayload {
            code: String,
            message: String,
        }

        let payload = ErrorPayload {
            code: match self {
                AppError::JupyterConnection(_) => "JUPYTER_CONNECTION",
                AppError::JupyterApi { .. } => "JUPYTER_API",
                AppError::JupyterAuth(_) => "JUPYTER_AUTH",
                AppError::Kernel(_) => "KERNEL",
                AppError::WebSocket(_) => "WEBSOCKET",
                AppError::Proxy(_) => "PROXY",
                AppError::Agent(_) => "AGENT",
                AppError::Serialization(_) => "SERIALIZATION",
                AppError::NotConnected => "NOT_CONNECTED",
                AppError::ServerNotFound(_) => "SERVER_NOT_FOUND",
                AppError::Io(_) => "IO",
                AppError::Other(_) => "OTHER",
            }
            .to_string(),
            message: self.to_string(),
        };

        payload.serialize(serializer)
    }
}

impl From<reqwest::Error> for AppError {
    fn from(err: reqwest::Error) -> Self {
        AppError::JupyterConnection(err.to_string())
    }
}

impl From<serde_json::Error> for AppError {
    fn from(err: serde_json::Error) -> Self {
        AppError::Serialization(err.to_string())
    }
}

impl From<tokio_tungstenite::tungstenite::Error> for AppError {
    fn from(err: tokio_tungstenite::tungstenite::Error) -> Self {
        AppError::WebSocket(err.to_string())
    }
}

impl From<url::ParseError> for AppError {
    fn from(err: url::ParseError) -> Self {
        AppError::JupyterConnection(format!("Invalid URL: {}", err))
    }
}
