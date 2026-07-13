//! LabNexus — Tool Registry for MCP-style tools.
//!
//! Stores tool definitions and routes tool executions requested by the LLM.

use crate::agent::mcp::external::{
    load_external_mcp_config, namespace_tool_name, ExternalMcpClient, ExternalToolBinding,
};
use crate::agent::mcp::jupyter_tools;
use crate::agent::types::*;
use crate::error::AppError;
use crate::state::AppState;
use futures_util::{stream, StreamExt};
use serde_json::json;
use std::collections::HashMap;
use std::sync::{Arc, RwLock};
use tauri::AppHandle;

#[derive(Clone)]
pub struct RegisteredTool {
    pub definition: ToolDefinition,
    pub requires_confirmation: bool,
    pub category: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ToolApprovalRequirement {
    pub required: bool,
    pub risk_level: &'static str,
    pub reason: String,
    pub permission_key: String,
    pub allow_session: bool,
}

#[derive(Clone)]
pub struct ToolRegistry {
    tools: Vec<RegisteredTool>,
    external_tools: Arc<RwLock<HashMap<String, ExternalToolBinding>>>,
    external_clients: Arc<RwLock<HashMap<String, ExternalMcpClient>>>,
}

impl Default for ToolRegistry {
    fn default() -> Self {
        Self::new()
    }
}

impl ToolRegistry {
    pub fn new() -> Self {
        let tools = vec![
            RegisteredTool {
                definition: ToolDefinition {
                    tool_type: "function".to_string(),
                    function: FunctionDefinition {
                        name: "jupyter.cell.execute".to_string(),
                        description: "Execute Python code in the active Jupyter notebook kernel. Use this to analyze data, plot charts, inspect variables, or run scripts.".to_string(),
                        parameters: json!({
                            "type": "object",
                            "properties": {
                                "code": { "type": "string", "description": "The Python code to execute." }
                            },
                            "required": ["code"]
                        }),
                    },
                },
                requires_confirmation: true,
                category: "Jupyter".to_string(),
            },
            RegisteredTool {
                definition: ToolDefinition {
                    tool_type: "function".to_string(),
                    function: FunctionDefinition {
                        name: "jupyter.cell.add".to_string(),
                        description: "Add a new code or markdown cell to the active Jupyter notebook.".to_string(),
                        parameters: json!({
                            "type": "object",
                            "properties": {
                                "cell_type": { "type": "string", "enum": ["code", "markdown"], "description": "Type of cell to add." },
                                "source": { "type": "string", "description": "Source code or text content." },
                                "position": { "type": "string", "enum": ["above", "below", "end"], "description": "Position relative to active cell or notebook end." }
                            },
                            "required": ["cell_type", "source"]
                        }),
                    },
                },
                requires_confirmation: true,
                category: "Jupyter".to_string(),
            },
            RegisteredTool {
                definition: ToolDefinition {
                    tool_type: "function".to_string(),
                    function: FunctionDefinition {
                        name: "jupyter.notebook.save".to_string(),
                        description: "Save the active Jupyter notebook.".to_string(),
                        parameters: json!({ "type": "object", "properties": {} }),
                    },
                },
                requires_confirmation: true,
                category: "Jupyter".to_string(),
            },
            RegisteredTool {
                definition: ToolDefinition {
                    tool_type: "function".to_string(),
                    function: FunctionDefinition {
                        name: "jupyter.file.read".to_string(),
                        description: "Read a text or code file from the remote Jupyter workspace.".to_string(),
                        parameters: json!({
                            "type": "object",
                            "properties": {
                                "path": { "type": "string", "description": "Relative file path on the remote Jupyter server." }
                            },
                            "required": ["path"]
                        }),
                    },
                },
                requires_confirmation: true,
                category: "Jupyter".to_string(),
            },
            RegisteredTool {
                definition: ToolDefinition {
                    tool_type: "function".to_string(),
                    function: FunctionDefinition {
                        name: "jupyter.kernel.restart".to_string(),
                        description: "Restart the current Jupyter kernel. This will clear all variables in memory.".to_string(),
                        parameters: json!({ "type": "object", "properties": {} }),
                    },
                },
                requires_confirmation: true,
                category: "Jupyter".to_string(),
            },
        ];

        Self {
            tools,
            external_tools: Arc::new(RwLock::new(HashMap::new())),
            external_clients: Arc::new(RwLock::new(HashMap::new())),
        }
    }

    /// Refresh enabled external MCP tools. A broken server is isolated and reported as a warning;
    /// tools from healthy servers remain available.
    pub async fn refresh_external_tools(&self) -> Vec<String> {
        let config = match load_external_mcp_config() {
            Ok(config) => config,
            Err(error) => return vec![error],
        };
        let mut discovered = HashMap::new();
        let existing_clients = self
            .external_clients
            .read()
            .map(|clients| clients.clone())
            .unwrap_or_default();
        let mut warnings = Vec::new();

        let discoveries = stream::iter(
            config
                .servers
                .into_iter()
                .filter(|server| server.enabled)
                .map(|server| {
                    let existing = existing_clients.get(&server.id).cloned();
                    async move {
                        let client = existing
                            .filter(|client| client.config == server)
                            .unwrap_or_else(|| ExternalMcpClient::new(server.clone()));
                        let result = client.list_tools().await;
                        (server, client, result)
                    }
                }),
        )
        .buffer_unordered(4)
        .collect::<Vec<_>>()
        .await;

        let mut active_clients = HashMap::new();
        for (server, client, result) in discoveries {
            active_clients.insert(server.id.clone(), client);
            match result {
                Ok(tools) => {
                    for tool in tools {
                        let namespaced_name = namespace_tool_name(&server.id, &tool.name);
                        if discovered.contains_key(&namespaced_name) {
                            warnings.push(format!(
                                "MCP tool name collision on '{}'; the later tool was ignored",
                                namespaced_name
                            ));
                            continue;
                        }
                        discovered.insert(
                            namespaced_name.clone(),
                            ExternalToolBinding {
                                namespaced_name,
                                original_name: tool.name,
                                server: server.clone(),
                                description: tool.description,
                                input_schema: tool.input_schema,
                                annotations: tool.annotations,
                            },
                        );
                    }
                }
                Err(error) => warnings.push(format!("MCP server '{}': {}", server.name, error)),
            }
        }

        if let Ok(mut external_tools) = self.external_tools.write() {
            *external_tools = discovered;
        } else {
            warnings.push("External MCP tool registry lock is unavailable".to_string());
        }
        if let Ok(mut clients) = self.external_clients.write() {
            *clients = active_clients;
        } else {
            warnings.push("External MCP client registry lock is unavailable".to_string());
        }
        warnings
    }

    pub async fn external_server_capabilities(
        &self,
        server_id: &str,
    ) -> Result<serde_json::Value, AppError> {
        let client = self.external_client(server_id)?;
        client.ping().await.map_err(AppError::Agent)?;
        Ok(client.capabilities().await)
    }

    pub async fn list_external_resources(
        &self,
        server_id: &str,
    ) -> Result<serde_json::Value, AppError> {
        self.external_client(server_id)?
            .list_resources()
            .await
            .map_err(AppError::Agent)
    }

    pub async fn list_external_resource_templates(
        &self,
        server_id: &str,
    ) -> Result<serde_json::Value, AppError> {
        self.external_client(server_id)?
            .list_resource_templates()
            .await
            .map_err(AppError::Agent)
    }

    pub async fn read_external_resource(
        &self,
        server_id: &str,
        uri: &str,
    ) -> Result<serde_json::Value, AppError> {
        self.external_client(server_id)?
            .read_resource(uri)
            .await
            .map_err(AppError::Agent)
    }

    pub async fn list_external_prompts(
        &self,
        server_id: &str,
    ) -> Result<serde_json::Value, AppError> {
        self.external_client(server_id)?
            .list_prompts()
            .await
            .map_err(AppError::Agent)
    }

    pub async fn get_external_prompt(
        &self,
        server_id: &str,
        name: &str,
        arguments: serde_json::Value,
    ) -> Result<serde_json::Value, AppError> {
        self.external_client(server_id)?
            .get_prompt(name, arguments)
            .await
            .map_err(AppError::Agent)
    }

    fn external_client(&self, server_id: &str) -> Result<ExternalMcpClient, AppError> {
        self.external_clients
            .read()
            .ok()
            .and_then(|clients| clients.get(server_id).cloned())
            .ok_or_else(|| AppError::Agent(format!("MCP server '{}' is not connected", server_id)))
    }

    /// Return all MCP tool definitions to be passed to LLM providers.
    pub fn get_definitions(&self) -> Vec<ToolDefinition> {
        let mut definitions: Vec<_> = self.tools.iter().map(|t| t.definition.clone()).collect();
        if let Ok(external_tools) = self.external_tools.read() {
            definitions.extend(external_tools.values().map(|binding| ToolDefinition {
                tool_type: "function".to_string(),
                function: FunctionDefinition {
                    name: binding.namespaced_name.clone(),
                    description: format!(
                        "External MCP tool from {}. {}",
                        binding.server.name, binding.description
                    ),
                    parameters: binding.input_schema.clone(),
                },
            }));
        }
        definitions.sort_by(|left, right| left.function.name.cmp(&right.function.name));
        definitions
    }

    /// Determine risk and approval scope for a concrete tool invocation.
    pub fn approval_requirement(
        &self,
        tool_name: &str,
        arguments: &serde_json::Value,
    ) -> ToolApprovalRequirement {
        if let Ok(external_tools) = self.external_tools.read() {
            if let Some(binding) = external_tools.get(tool_name) {
                let read_only = binding.annotations["readOnlyHint"]
                    .as_bool()
                    .unwrap_or(false);
                let destructive = binding.annotations["destructiveHint"]
                    .as_bool()
                    .unwrap_or(!read_only);
                return ToolApprovalRequirement {
                    required: true,
                    risk_level: if read_only && !destructive {
                        "sensitive"
                    } else {
                        "high"
                    },
                    reason: if read_only && !destructive {
                        format!(
                            "Reads data through external MCP server '{}' tool '{}'. Server annotations are treated as hints, not a security boundary.",
                            binding.server.name, binding.original_name
                        )
                    } else {
                        format!(
                            "Calls external MCP server '{}' tool '{}'; it may access external data or perform side effects.",
                            binding.server.name, binding.original_name
                        )
                    },
                    permission_key: binding.namespaced_name.clone(),
                    allow_session: false,
                };
            }
        }
        let registered = self
            .tools
            .iter()
            .find(|tool| tool.definition.function.name == tool_name);
        if registered.is_none() {
            return ToolApprovalRequirement {
                required: true,
                risk_level: "critical",
                reason: "Unknown tool capability; execution is denied unless explicitly reviewed."
                    .to_string(),
                permission_key: format!("unknown:{}", tool_name),
                allow_session: false,
            };
        }

        match tool_name {
            "jupyter.cell.execute" => analyze_python_execution(arguments),
            "jupyter.file.read" => ToolApprovalRequirement {
                required: true,
                risk_level: "sensitive",
                reason: "Reads workspace content that may be sent to the configured AI provider."
                    .to_string(),
                permission_key: tool_name.to_string(),
                allow_session: true,
            },
            "jupyter.cell.add" | "jupyter.notebook.save" => ToolApprovalRequirement {
                required: true,
                risk_level: "mutation",
                reason: "Changes the active notebook state.".to_string(),
                permission_key: tool_name.to_string(),
                allow_session: true,
            },
            "jupyter.kernel.restart" => ToolApprovalRequirement {
                required: true,
                risk_level: "critical",
                reason: "Restarts the kernel and clears all in-memory variables.".to_string(),
                permission_key: tool_name.to_string(),
                allow_session: false,
            },
            _ => ToolApprovalRequirement {
                required: registered
                    .map(|tool| tool.requires_confirmation)
                    .unwrap_or(true),
                risk_level: "high",
                reason: "Tool requires explicit approval.".to_string(),
                permission_key: tool_name.to_string(),
                allow_session: false,
            },
        }
    }

    /// Execute a tool by name with provided JSON arguments.
    pub async fn execute(
        &self,
        tool_name: &str,
        arguments: &serde_json::Value,
        context: &AgentChatContext,
        state: &AppState,
        app: &AppHandle,
    ) -> Result<String, AppError> {
        let external = self
            .external_tools
            .read()
            .ok()
            .and_then(|tools| tools.get(tool_name).cloned());
        if let Some(binding) = external {
            let client = self
                .external_clients
                .read()
                .ok()
                .and_then(|clients| clients.get(&binding.server.id).cloned())
                .unwrap_or_else(|| ExternalMcpClient::new(binding.server.clone()));
            let result = client
                .call_tool(&binding.original_name, arguments)
                .await
                .map_err(AppError::Agent);
            if client.take_tools_changed().await {
                for warning in self.refresh_external_tools().await {
                    log::warn!("MCP dynamic refresh warning: {}", warning);
                }
            }
            return result;
        }

        match tool_name {
            "jupyter.cell.execute" => jupyter_tools::execute_cell(arguments, context, state).await,
            "jupyter.cell.add" => jupyter_tools::add_cell(arguments, context, state, app).await,
            "jupyter.notebook.save" => jupyter_tools::save_notebook(context, state, app).await,
            "jupyter.file.read" => jupyter_tools::read_file(arguments, context, state).await,
            "jupyter.kernel.restart" => jupyter_tools::restart_kernel(context, state).await,
            _ => Err(AppError::Agent(format!(
                "Unknown tool requested: {}",
                tool_name
            ))),
        }
    }
}

fn analyze_python_execution(arguments: &serde_json::Value) -> ToolApprovalRequirement {
    let code = arguments["code"].as_str().unwrap_or_default();
    let normalized = code.to_lowercase();
    let high_risk_markers = [
        "subprocess",
        "os.system",
        "os.remove",
        "os.unlink",
        "shutil.rmtree",
        ".unlink(",
        ".write_text(",
        ".write_bytes(",
        "requests.",
        "urllib.request",
        "httpx.",
        "socket.",
        "pip install",
        "%pip",
        "%conda",
        "!rm ",
        "!curl ",
        "!wget ",
        "__import__(",
        "eval(",
        "exec(",
    ];
    let file_write = ["open(", "pathlib.path("]
        .iter()
        .any(|marker| normalized.contains(marker))
        && ["'w'", "\"w\"", "'a'", "\"a\"", "'x'", "\"x\""]
            .iter()
            .any(|mode| normalized.contains(mode));
    let high_risk = file_write
        || high_risk_markers
            .iter()
            .any(|marker| normalized.contains(marker));

    ToolApprovalRequirement {
        required: true,
        risk_level: if high_risk { "high" } else { "compute" },
        reason: if high_risk {
            "Python code may access the network, filesystem, shell, package manager, or dynamic execution."
                .to_string()
        } else {
            "Executes Python in the active kernel and may change variables or kernel state."
                .to_string()
        },
        permission_key: if high_risk {
            "jupyter.cell.execute:high-risk".to_string()
        } else {
            "jupyter.cell.execute:compute".to_string()
        },
        allow_session: !high_risk,
    }
}

#[cfg(test)]
mod tests {
    use super::ToolRegistry;

    #[test]
    fn python_risk_analysis_distinguishes_compute_and_side_effects() {
        let registry = ToolRegistry::new();
        let compute = registry.approval_requirement(
            "jupyter.cell.execute",
            &serde_json::json!({"code": "df.describe()"}),
        );
        assert_eq!(compute.risk_level, "compute");
        assert!(compute.allow_session);

        let risky = registry.approval_requirement(
            "jupyter.cell.execute",
            &serde_json::json!({"code": "import subprocess; subprocess.run(['rm', 'x'])"}),
        );
        assert_eq!(risky.risk_level, "high");
        assert!(!risky.allow_session);
    }
}
