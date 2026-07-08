//! LabNexus — Tool Registry for MCP-style tools.
//!
//! Stores tool definitions and routes tool executions requested by the LLM.

use crate::agent::mcp::jupyter_tools;
use crate::agent::types::*;
use crate::error::AppError;
use crate::state::AppState;
use serde_json::json;
use tauri::AppHandle;

#[derive(Clone)]
pub struct RegisteredTool {
    pub definition: ToolDefinition,
    pub requires_confirmation: bool,
    pub category: String,
}

#[derive(Clone)]
pub struct ToolRegistry {
    tools: Vec<RegisteredTool>,
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
                requires_confirmation: false,
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
                requires_confirmation: false,
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
                requires_confirmation: false,
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
                requires_confirmation: false,
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

        Self { tools }
    }

    /// Return all MCP tool definitions to be passed to LLM providers.
    pub fn get_definitions(&self) -> Vec<ToolDefinition> {
        self.tools.iter().map(|t| t.definition.clone()).collect()
    }

    /// Check if a tool requires explicit user confirmation before execution.
    pub fn requires_confirmation(&self, tool_name: &str) -> bool {
        self.tools
            .iter()
            .find(|t| t.definition.function.name == tool_name)
            .map(|t| t.requires_confirmation)
            .unwrap_or(false)
    }

    /// Execute a tool by name with provided JSON arguments.
    pub async fn execute(
        &self,
        tool_name: &str,
        arguments: &serde_json::Value,
        state: &AppState,
        app: &AppHandle,
    ) -> Result<String, AppError> {
        match tool_name {
            "jupyter.cell.execute" => jupyter_tools::execute_cell(arguments, state).await,
            "jupyter.cell.add" => jupyter_tools::add_cell(arguments, app).await,
            "jupyter.notebook.save" => jupyter_tools::save_notebook(app).await,
            "jupyter.file.read" => jupyter_tools::read_file(arguments, state).await,
            "jupyter.kernel.restart" => jupyter_tools::restart_kernel(state).await,
            _ => Err(AppError::Agent(format!(
                "Unknown tool requested: {}",
                tool_name
            ))),
        }
    }
}
