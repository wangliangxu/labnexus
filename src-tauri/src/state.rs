//! LabNexus — Application state management.
//!
//! Manages multi-server connections and shared application state
//! accessible from Tauri commands.

use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::{oneshot, RwLock};

use crate::jupyter::client::JupyterClient;
use crate::jupyter::terminal_ws::TerminalWsManager;
use crate::jupyter::types::*;
use crate::jupyter::ws::KernelWsManager;

/// Global application state shared across Tauri commands.
pub struct AppState {
    /// Active Jupyter server connections (server_id → client).
    pub connections: Arc<RwLock<HashMap<String, ManagedConnection>>>,
    /// The currently active/focused server ID.
    pub active_server_id: Arc<RwLock<Option<String>>>,
    /// Kernel WebSocket manager (handles SOCKS5 tunnels and real-time messaging).
    pub kernel_ws: Arc<KernelWsManager>,
    /// Terminal WebSocket manager.
    pub terminal_ws: Arc<TerminalWsManager>,
    /// AI Agent ReAct engine.
    pub agent: Arc<crate::agent::AgentEngine>,
    /// Skill registry.
    pub skills: Arc<crate::agent::SkillRegistry>,
    /// Knowledge store (lazy initialized).
    pub knowledge_store: Arc<RwLock<Option<crate::agent::KnowledgeStore>>>,
    /// Trace store (lazy initialized).
    pub trace_store: Arc<RwLock<Option<crate::agent::TraceStore>>>,
    /// Pending notebook UI actions awaiting an acknowledgement from NotebookEditor.
    pub pending_notebook_actions:
        Arc<RwLock<HashMap<String, oneshot::Sender<Result<String, String>>>>>,
}

/// A managed connection to a single Jupyter server.
pub struct ManagedConnection {
    /// HTTP client for REST API calls.
    pub client: JupyterClient,
    /// Current connection status.
    pub status: ConnectionStatus,
    /// Server information (populated after successful connection).
    pub server_info: Option<ServerInfo>,
    /// The server configuration used to create this connection.
    pub config: JupyterServerConfig,
    /// Error message if connection failed.
    pub error_message: Option<String>,
}

impl AppState {
    /// Create a new empty AppState.
    pub fn new() -> Self {
        AppState {
            connections: Arc::new(RwLock::new(HashMap::new())),
            active_server_id: Arc::new(RwLock::new(None)),
            kernel_ws: Arc::new(KernelWsManager::new()),
            terminal_ws: Arc::new(TerminalWsManager::new()),
            agent: Arc::new(crate::agent::AgentEngine::new()),
            skills: Arc::new(crate::agent::SkillRegistry::new()),
            knowledge_store: Arc::new(RwLock::new(None)),
            trace_store: Arc::new(RwLock::new(None)),
            pending_notebook_actions: Arc::new(RwLock::new(HashMap::new())),
        }
    }

    pub async fn complete_notebook_action(
        &self,
        action_id: &str,
        result: Result<String, String>,
    ) -> Result<(), String> {
        let sender = self
            .pending_notebook_actions
            .write()
            .await
            .remove(action_id)
            .ok_or_else(|| "No matching pending notebook action found".to_string())?;
        sender
            .send(result)
            .map_err(|_| "Notebook action receiver is no longer available".to_string())
    }

    pub async fn get_knowledge_store(&self) -> Result<crate::agent::KnowledgeStore, String> {
        {
            let lock = self.knowledge_store.read().await;
            if let Some(store) = lock.as_ref() {
                return Ok(store.clone());
            }
        }
        let mut lock = self.knowledge_store.write().await;
        if let Some(store) = lock.as_ref() {
            return Ok(store.clone());
        }
        let store = crate::agent::KnowledgeStore::init().await?;
        *lock = Some(store.clone());
        Ok(store)
    }

    pub async fn get_trace_store(&self) -> Result<crate::agent::TraceStore, String> {
        {
            let lock = self.trace_store.read().await;
            if let Some(store) = lock.as_ref() {
                return Ok(store.clone());
            }
        }
        let mut lock = self.trace_store.write().await;
        if let Some(store) = lock.as_ref() {
            return Ok(store.clone());
        }
        let store = crate::agent::TraceStore::init().await?;
        *lock = Some(store.clone());
        Ok(store)
    }

    /// Get the active server's client, if connected.
    pub async fn active_client(&self) -> Option<JupyterClient> {
        let active_id = self.active_server_id.read().await;
        if let Some(id) = active_id.as_ref() {
            let connections = self.connections.read().await;
            connections.get(id).map(|c| c.client.clone())
        } else {
            None
        }
    }

    /// Get a specific server's client by ID.
    pub async fn get_client(&self, server_id: &str) -> Option<JupyterClient> {
        let connections = self.connections.read().await;
        connections.get(server_id).map(|c| c.client.clone())
    }

    /// Get connection info for all servers (serializable for frontend).
    pub async fn get_all_connections(&self) -> Vec<ServerConnection> {
        let connections = self.connections.read().await;
        connections
            .values()
            .map(|c| ServerConnection {
                config: c.config.clone(),
                status: c.status.clone(),
                server_info: c.server_info.clone(),
                error_message: c.error_message.clone(),
            })
            .collect()
    }
}

impl Default for AppState {
    fn default() -> Self {
        Self::new()
    }
}
