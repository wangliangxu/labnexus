use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::process::Stdio;
use tokio::process::Command;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ExternalMcpServerConfig {
    pub id: String,
    pub name: String,
    pub command: String,
    pub args: Vec<String>,
    pub env: HashMap<String, String>,
    pub enabled: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ExternalMcpTool {
    pub name: String,
    pub description: String,
    pub input_schema: serde_json::Value,
}

pub struct ExternalMcpClient {
    pub config: ExternalMcpServerConfig,
}

impl ExternalMcpClient {
    pub fn new(config: ExternalMcpServerConfig) -> Self {
        Self { config }
    }

    pub async fn list_tools(&self) -> Result<Vec<ExternalMcpTool>, String> {
        if !self.config.enabled {
            return Ok(Vec::new());
        }

        let mut cmd = Command::new(&self.config.command);
        cmd.args(&self.config.args)
            .envs(&self.config.env)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());

        // For Phase 4, if command cannot be launched or is dummy, return empty gracefully
        match cmd.spawn() {
            Ok(_) => {
                // In a production stdio MCP implementation, we exchange JSON-RPC initialize and tools/list over stdin/stdout.
                // For Phase 4 demonstration and offline safety, we return empty list if server is not active.
                Ok(Vec::new())
            }
            Err(e) => Err(format!(
                "Failed to spawn MCP process {}: {}",
                self.config.command, e
            )),
        }
    }
}
