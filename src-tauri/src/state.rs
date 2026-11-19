//! LabNexus — Application state management.
//!
//! Manages multi-server connections and shared application state
//! accessible from Tauri commands.

use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::{oneshot, RwLock};

use crate::error::AppError;
use crate::jupyter::client::JupyterClient;
use crate::jupyter::ssh::SshTunnel;
use crate::jupyter::terminal_ws::TerminalWsManager;
use crate::jupyter::types::*;
use crate::jupyter::ws::KernelWsManager;

/// Resolves a pending notebook UI action with the editor's result.
pub type NotebookActionSender = oneshot::Sender<Result<String, String>>;

/// Global application state shared across Tauri commands.
pub struct AppState {
    pub local_jupyter: crate::jupyter::local::LocalJupyter,
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
    pub pending_notebook_actions: Arc<RwLock<HashMap<String, NotebookActionSender>>>,
}

/// A managed connection to a single Jupyter server.
pub struct ManagedConnection {
    /// HTTP client for REST API calls.
    pub client: Option<JupyterClient>,
    /// Current connection status.
    pub status: ConnectionStatus,
    /// Server information (populated after successful connection).
    pub server_info: Option<ServerInfo>,
    /// The server configuration used to create this connection.
    pub config: JupyterServerConfig,
    pub ssh: Option<Arc<SshTunnel>>,
    /// Error message if connection failed.
    pub error_message: Option<String>,
}

impl ManagedConnection {
    pub fn websocket_config(&self) -> JupyterServerConfig {
        let mut config = self.config.clone();
        if let Some(ssh) = &self.ssh {
            let address = ssh.address();
            config.proxy = Some(ProxyConfig {
                proxy_type: ProxyType::Socks5,
                host: address.ip().to_string(),
                port: address.port(),
                username: None,
                password: None,
            });
        }
        config
    }
}

impl AppState {
    /// Create a new empty AppState.
    pub fn new() -> Self {
        AppState {
            local_jupyter: Default::default(),
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
    ) -> Result<(), AppError> {
        let sender = self
            .pending_notebook_actions
            .write()
            .await
            .remove(action_id)
            .ok_or_else(|| {
                AppError::Agent("No matching pending notebook action found".to_string())
            })?;
        sender.send(result).map_err(|_| {
            AppError::Agent("Notebook action receiver is no longer available".to_string())
        })
    }

    pub async fn get_knowledge_store(&self) -> Result<crate::agent::KnowledgeStore, AppError> {
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
        let store = crate::agent::KnowledgeStore::init()
            .await
            .map_err(AppError::Agent)?;
        *lock = Some(store.clone());
        Ok(store)
    }

    pub async fn get_trace_store(&self) -> Result<crate::agent::TraceStore, AppError> {
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
        let store = crate::agent::TraceStore::init()
            .await
            .map_err(AppError::Agent)?;
        *lock = Some(store.clone());
        Ok(store)
    }

    /// Release every background resource before the process exits.
    pub async fn shutdown(&self) {
        self.agent.shutdown().await;
        self.kernel_ws.disconnect_all().await;
        self.terminal_ws.disconnect_all().await;
        self.connections.write().await.clear();
        self.pending_notebook_actions.write().await.clear();
        if let Some(store) = self.trace_store.read().await.as_ref() {
            store.close().await;
        }
        if let Some(store) = self.knowledge_store.read().await.as_ref() {
            store.close().await;
        }
        if let Err(error) = self.local_jupyter.stop().await {
            log::warn!("Failed to stop local Jupyter on exit: {}", error);
        }
    }

    /// Get the active server's client, if connected.
    pub async fn active_client(&self) -> Option<JupyterClient> {
        let active_id = self.active_server_id.read().await.clone()?;
        self.get_client(&active_id).await
    }

    /// Get a specific server's client by ID.
    pub async fn get_client(&self, server_id: &str) -> Option<JupyterClient> {
        let connections = self.connections.read().await;
        connections.get(server_id).and_then(|c| c.client.clone())
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
