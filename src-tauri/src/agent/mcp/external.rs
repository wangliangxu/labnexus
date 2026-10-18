use serde::{Deserialize, Serialize};
use serde_json::json;
use std::collections::HashMap;
use std::path::PathBuf;
use std::process::Stdio;
use std::sync::Arc;
use std::time::Duration;
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader, Lines};
use tokio::process::{Child, ChildStdin, ChildStdout, Command};
use tokio::time::timeout;

const MCP_PROTOCOL_VERSION: &str = "2025-11-25";
const SUPPORTED_MCP_PROTOCOL_VERSIONS: &[&str] = &["2025-11-25", "2025-06-18"];

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ExternalMcpServerConfig {
    pub id: String,
    pub name: String,
    #[serde(default = "default_transport")]
    pub transport: String,
    pub command: String,
    #[serde(default)]
    pub args: Vec<String>,
    #[serde(default)]
    pub env: HashMap<String, String>,
    #[serde(default)]
    pub url: String,
    #[serde(default)]
    pub headers: HashMap<String, String>,
    #[serde(default = "default_enabled")]
    pub enabled: bool,
    #[serde(default = "default_timeout_seconds")]
    pub timeout_seconds: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct ExternalMcpConfigFile {
    #[serde(default)]
    pub servers: Vec<ExternalMcpServerConfig>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ExternalMcpTool {
    pub name: String,
    pub description: String,
    pub input_schema: serde_json::Value,
    pub annotations: serde_json::Value,
}

#[derive(Debug, Clone)]
pub struct ExternalToolBinding {
    pub namespaced_name: String,
    pub original_name: String,
    pub server: ExternalMcpServerConfig,
    pub description: String,
    pub input_schema: serde_json::Value,
    pub annotations: serde_json::Value,
}

#[derive(Clone)]
pub struct ExternalMcpClient {
    pub config: ExternalMcpServerConfig,
    process: Arc<tokio::sync::Mutex<Option<McpConnection>>>,
}

enum McpConnection {
    Stdio(McpProcess),
    Http(HttpMcpSession),
}

struct McpProcess {
    child: Child,
    stdin: ChildStdin,
    lines: Lines<BufReader<ChildStdout>>,
    request_timeout: Duration,
    capabilities: serde_json::Value,
    tools_changed: bool,
}

struct HttpMcpSession {
    client: reqwest::Client,
    endpoint: String,
    headers: HashMap<String, String>,
    session_id: Option<String>,
    negotiated_protocol: Option<String>,
    request_timeout: Duration,
    capabilities: serde_json::Value,
    tools_changed: bool,
}

impl Drop for McpProcess {
    fn drop(&mut self) {
        let _ = self.child.start_kill();
    }
}

impl McpProcess {
    async fn spawn(config: &ExternalMcpServerConfig) -> Result<Self, String> {
        validate_server_config(config)?;
        let mut command = Command::new(&config.command);
        command
            .args(&config.args)
            .envs(&config.env)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .kill_on_drop(true);
        let mut child = command.spawn().map_err(|error| {
            format!(
                "Failed to start MCP server '{}' ({}): {}",
                config.name, config.command, error
            )
        })?;
        let stdin = child
            .stdin
            .take()
            .ok_or_else(|| "MCP server stdin was not available".to_string())?;
        let stdout = child
            .stdout
            .take()
            .ok_or_else(|| "MCP server stdout was not available".to_string())?;
        Ok(Self {
            child,
            stdin,
            lines: BufReader::new(stdout).lines(),
            request_timeout: Duration::from_secs(config.timeout_seconds.clamp(1, 120)),
            capabilities: json!({}),
            tools_changed: false,
        })
    }

    async fn send(&mut self, message: &serde_json::Value) -> Result<(), String> {
        let mut encoded = serde_json::to_vec(message)
            .map_err(|error| format!("Failed to encode MCP message: {}", error))?;
        encoded.push(b'\n');
        self.stdin
            .write_all(&encoded)
            .await
            .map_err(|error| format!("Failed to write MCP message: {}", error))?;
        self.stdin
            .flush()
            .await
            .map_err(|error| format!("Failed to flush MCP message: {}", error))
    }

    async fn request(
        &mut self,
        id: u64,
        method: &str,
        params: serde_json::Value,
    ) -> Result<serde_json::Value, String> {
        self.send(&json!({
            "jsonrpc": "2.0",
            "id": id,
            "method": method,
            "params": params,
        }))
        .await?;
        let response = timeout(self.request_timeout, async {
            loop {
                let line = self
                    .lines
                    .next_line()
                    .await
                    .map_err(|error| format!("Failed to read MCP response: {}", error))?
                    .ok_or_else(|| "MCP server closed stdout unexpectedly".to_string())?;
                if line.len() > 10 * 1024 * 1024 {
                    return Err("MCP stdio response exceeded 10 MiB".to_string());
                }
                let response: serde_json::Value = serde_json::from_str(&line)
                    .map_err(|error| format!("Invalid MCP JSON-RPC response: {}", error))?;
                if let Some(server_method) = response.get("method").and_then(|value| value.as_str())
                {
                    if server_method == "notifications/tools/list_changed" {
                        self.tools_changed = true;
                    }
                    if let Some(server_request_id) = response.get("id").cloned() {
                        let reply = if server_method == "ping" {
                            json!({"jsonrpc": "2.0", "id": server_request_id, "result": {}})
                        } else {
                            json!({
                                "jsonrpc": "2.0",
                                "id": server_request_id,
                                "error": {"code": -32601, "message": "Client method not supported"}
                            })
                        };
                        self.send(&reply).await?;
                    }
                    continue;
                }
                if response.get("id").and_then(|value| value.as_u64()) != Some(id) {
                    continue;
                }
                if let Some(error) = response.get("error") {
                    return Err(format!("MCP {} failed: {}", method, error));
                }
                return response
                    .get("result")
                    .cloned()
                    .ok_or_else(|| format!("MCP {} response did not contain result", method));
            }
        })
        .await;
        match response {
            Ok(result) => result,
            Err(_) => {
                let _ = self
                    .send(&json!({
                        "jsonrpc": "2.0",
                        "method": "notifications/cancelled",
                        "params": {"requestId": id, "reason": "LabNexus request timeout"}
                    }))
                    .await;
                Err(format!("MCP {} timed out", method))
            }
        }
    }

    async fn initialize(&mut self) -> Result<(), String> {
        let result = self
            .request(
                1,
                "initialize",
                json!({
                    "protocolVersion": MCP_PROTOCOL_VERSION,
                    "capabilities": {},
                    "clientInfo": { "name": "LabNexus", "version": env!("CARGO_PKG_VERSION") }
                }),
            )
            .await?;
        let negotiated = result["protocolVersion"].as_str().unwrap_or_default();
        validate_negotiated_protocol(negotiated)?;
        self.capabilities = result
            .get("capabilities")
            .cloned()
            .unwrap_or_else(|| json!({}));
        self.send(&json!({
            "jsonrpc": "2.0",
            "method": "notifications/initialized"
        }))
        .await
    }
}

impl HttpMcpSession {
    fn new(config: &ExternalMcpServerConfig) -> Result<Self, String> {
        let client = reqwest::Client::builder()
            .timeout(Duration::from_secs(config.timeout_seconds.clamp(1, 120)))
            .build()
            .map_err(|error| format!("Failed to create MCP HTTP client: {}", error))?;
        Ok(Self {
            client,
            endpoint: config.url.clone(),
            headers: config.headers.clone(),
            session_id: None,
            negotiated_protocol: None,
            request_timeout: Duration::from_secs(config.timeout_seconds.clamp(1, 120)),
            capabilities: json!({}),
            tools_changed: false,
        })
    }

    async fn send_message(
        &mut self,
        message: &serde_json::Value,
        expected_id: Option<u64>,
    ) -> Result<Option<serde_json::Value>, String> {
        let mut request = self
            .client
            .post(&self.endpoint)
            .header(reqwest::header::CONTENT_TYPE, "application/json")
            .header(
                reqwest::header::ACCEPT,
                "application/json, text/event-stream",
            )
            .json(message);
        if let Some(session_id) = &self.session_id {
            request = request.header("Mcp-Session-Id", session_id);
        }
        if let Some(protocol) = &self.negotiated_protocol {
            request = request.header("MCP-Protocol-Version", protocol);
        }
        for (name, value) in &self.headers {
            request = request.header(name, value);
        }
        let response = timeout(self.request_timeout, request.send())
            .await
            .map_err(|_| "MCP HTTP request timed out".to_string())?
            .map_err(|error| format!("MCP HTTP request failed: {}", error))?;
        if let Some(value) = response
            .headers()
            .get("Mcp-Session-Id")
            .and_then(|value| value.to_str().ok())
        {
            self.session_id = Some(value.to_string());
        }
        let status = response.status();
        if response.content_length().unwrap_or(0) > 10 * 1024 * 1024 {
            return Err("MCP HTTP response exceeded 10 MiB".to_string());
        }
        let content_type = response
            .headers()
            .get(reqwest::header::CONTENT_TYPE)
            .and_then(|value| value.to_str().ok())
            .unwrap_or_default()
            .to_string();
        let body_bytes = response
            .bytes()
            .await
            .map_err(|error| format!("Failed to read MCP HTTP response: {}", error))?;
        if body_bytes.len() > 10 * 1024 * 1024 {
            return Err("MCP HTTP response exceeded 10 MiB".to_string());
        }
        let body = String::from_utf8_lossy(&body_bytes).to_string();
        if !status.is_success() {
            return Err(format!("MCP HTTP error {}: {}", status, body));
        }
        if expected_id.is_none() || body.trim().is_empty() {
            return Ok(None);
        }
        let messages = if content_type.contains("text/event-stream") {
            body.lines()
                .filter_map(|line| line.trim().strip_prefix("data:"))
                .filter_map(|data| serde_json::from_str::<serde_json::Value>(data.trim()).ok())
                .collect::<Vec<_>>()
        } else {
            let value: serde_json::Value = serde_json::from_str(&body)
                .map_err(|error| format!("Invalid MCP HTTP JSON response: {}", error))?;
            value.as_array().cloned().unwrap_or_else(|| vec![value])
        };
        for response in messages {
            if response["method"] == "notifications/tools/list_changed" {
                self.tools_changed = true;
                continue;
            }
            if response.get("id").and_then(|value| value.as_u64()) == expected_id {
                return Ok(Some(response));
            }
        }
        Err("MCP HTTP response did not contain the requested JSON-RPC id".to_string())
    }

    async fn request(
        &mut self,
        id: u64,
        method: &str,
        params: serde_json::Value,
    ) -> Result<serde_json::Value, String> {
        let response = self
            .send_message(
                &json!({"jsonrpc": "2.0", "id": id, "method": method, "params": params}),
                Some(id),
            )
            .await;
        let response = match response {
            Ok(Some(response)) => response,
            Ok(None) => return Err(format!("MCP {} returned no response", method)),
            Err(error) => {
                let _ = self
                    .send_message(
                        &json!({
                            "jsonrpc": "2.0",
                            "method": "notifications/cancelled",
                            "params": {"requestId": id, "reason": error}
                        }),
                        None,
                    )
                    .await;
                return Err(error);
            }
        };
        if let Some(error) = response.get("error") {
            return Err(format!("MCP {} failed: {}", method, error));
        }
        response
            .get("result")
            .cloned()
            .ok_or_else(|| format!("MCP {} response did not contain result", method))
    }

    async fn initialize(&mut self) -> Result<(), String> {
        let result = self
            .request(
                1,
                "initialize",
                json!({
                    "protocolVersion": MCP_PROTOCOL_VERSION,
                    "capabilities": {},
                    "clientInfo": {"name": "LabNexus", "version": env!("CARGO_PKG_VERSION")}
                }),
            )
            .await?;
        let negotiated = result["protocolVersion"].as_str().unwrap_or_default();
        validate_negotiated_protocol(negotiated)?;
        self.negotiated_protocol = Some(negotiated.to_string());
        self.capabilities = result
            .get("capabilities")
            .cloned()
            .unwrap_or_else(|| json!({}));
        self.send_message(
            &json!({"jsonrpc": "2.0", "method": "notifications/initialized"}),
            None,
        )
        .await?;
        Ok(())
    }
}

impl McpConnection {
    async fn request(
        &mut self,
        id: u64,
        method: &str,
        params: serde_json::Value,
    ) -> Result<serde_json::Value, String> {
        match self {
            Self::Stdio(process) => process.request(id, method, params).await,
            Self::Http(session) => session.request(id, method, params).await,
        }
    }

    fn capabilities(&self) -> serde_json::Value {
        match self {
            Self::Stdio(process) => process.capabilities.clone(),
            Self::Http(session) => session.capabilities.clone(),
        }
    }

    fn take_tools_changed(&mut self) -> bool {
        match self {
            Self::Stdio(process) => std::mem::take(&mut process.tools_changed),
            Self::Http(session) => std::mem::take(&mut session.tools_changed),
        }
    }
}

impl ExternalMcpClient {
    pub fn new(config: ExternalMcpServerConfig) -> Self {
        Self {
            config,
            process: Arc::new(tokio::sync::Mutex::new(None)),
        }
    }

    pub async fn list_tools(&self) -> Result<Vec<ExternalMcpTool>, String> {
        if !self.config.enabled {
            return Ok(Vec::new());
        }
        let mut connection = self.process.lock().await;
        ensure_connected(&mut connection, &self.config).await?;
        let result =
            list_tools_from_connection(connection.as_mut().expect("MCP connection initialized"))
                .await;
        if result
            .as_ref()
            .err()
            .is_some_and(|error| is_transport_error(error))
        {
            *connection = None;
        }
        result
    }

    pub async fn call_tool(
        &self,
        tool_name: &str,
        arguments: &serde_json::Value,
    ) -> Result<String, String> {
        let mut connection = self.process.lock().await;
        ensure_connected(&mut connection, &self.config).await?;
        let result = connection
            .as_mut()
            .expect("MCP connection initialized")
            .request(
                2,
                "tools/call",
                json!({ "name": tool_name, "arguments": arguments }),
            )
            .await;
        if result
            .as_ref()
            .err()
            .is_some_and(|error| is_transport_error(error))
        {
            *connection = None;
        }
        let result = result?;
        let output = format_tool_result(&result);
        if result["isError"].as_bool().unwrap_or(false) {
            Err(output)
        } else {
            Ok(output)
        }
    }

    pub async fn list_resources(&self) -> Result<serde_json::Value, String> {
        self.request_paginated("resources/list", "resources").await
    }

    pub async fn list_resource_templates(&self) -> Result<serde_json::Value, String> {
        self.request_paginated("resources/templates/list", "resourceTemplates")
            .await
    }

    pub async fn read_resource(&self, uri: &str) -> Result<serde_json::Value, String> {
        self.request_method("resources/read", json!({"uri": uri}))
            .await
    }

    pub async fn list_prompts(&self) -> Result<serde_json::Value, String> {
        self.request_paginated("prompts/list", "prompts").await
    }

    pub async fn get_prompt(
        &self,
        name: &str,
        arguments: serde_json::Value,
    ) -> Result<serde_json::Value, String> {
        self.request_method("prompts/get", json!({"name": name, "arguments": arguments}))
            .await
    }

    pub async fn ping(&self) -> Result<(), String> {
        self.request_method("ping", json!({})).await.map(|_| ())
    }

    pub async fn take_tools_changed(&self) -> bool {
        let mut connection = self.process.lock().await;
        connection
            .as_mut()
            .map(McpConnection::take_tools_changed)
            .unwrap_or(false)
    }

    pub async fn capabilities(&self) -> serde_json::Value {
        let connection = self.process.lock().await;
        connection
            .as_ref()
            .map(McpConnection::capabilities)
            .unwrap_or_else(|| json!({}))
    }

    async fn request_method(
        &self,
        method: &str,
        params: serde_json::Value,
    ) -> Result<serde_json::Value, String> {
        let mut connection = self.process.lock().await;
        ensure_connected(&mut connection, &self.config).await?;
        let result = connection
            .as_mut()
            .expect("MCP connection initialized")
            .request(2, method, params)
            .await;
        if result
            .as_ref()
            .err()
            .is_some_and(|error| is_transport_error(error))
        {
            *connection = None;
        }
        result
    }

    async fn request_paginated(
        &self,
        method: &str,
        result_key: &str,
    ) -> Result<serde_json::Value, String> {
        let mut connection = self.process.lock().await;
        ensure_connected(&mut connection, &self.config).await?;
        let result = request_paginated_connection(
            connection.as_mut().expect("MCP connection initialized"),
            method,
            result_key,
        )
        .await;
        if result
            .as_ref()
            .err()
            .is_some_and(|error| is_transport_error(error))
        {
            *connection = None;
        }
        result
    }
}

async fn list_tools_from_connection(
    process: &mut McpConnection,
) -> Result<Vec<ExternalMcpTool>, String> {
    let mut cursor: Option<String> = None;
    let mut request_id = 2_u64;
    let mut tools = Vec::new();
    loop {
        let params = cursor
            .as_ref()
            .map(|cursor| json!({ "cursor": cursor }))
            .unwrap_or_else(|| json!({}));
        let result = process.request(request_id, "tools/list", params).await?;
        request_id += 1;
        let page = result["tools"]
            .as_array()
            .ok_or_else(|| "MCP tools/list result omitted tools array".to_string())?;
        for tool in page {
            let name = tool["name"].as_str().unwrap_or_default().to_string();
            if name.is_empty() {
                continue;
            }
            tools.push(ExternalMcpTool {
                name,
                description: tool["description"].as_str().unwrap_or_default().to_string(),
                input_schema: tool
                    .get("inputSchema")
                    .cloned()
                    .unwrap_or_else(|| json!({ "type": "object", "properties": {} })),
                annotations: tool
                    .get("annotations")
                    .cloned()
                    .unwrap_or_else(|| json!({})),
            });
        }
        cursor = result["nextCursor"].as_str().map(ToString::to_string);
        if cursor.is_none() || tools.len() >= 200 {
            break;
        }
    }
    Ok(tools)
}

async fn request_paginated_connection(
    process: &mut McpConnection,
    method: &str,
    result_key: &str,
) -> Result<serde_json::Value, String> {
    let mut cursor: Option<String> = None;
    let mut request_id = 2_u64;
    let mut combined = Vec::new();
    loop {
        let params = cursor
            .as_ref()
            .map(|cursor| json!({"cursor": cursor}))
            .unwrap_or_else(|| json!({}));
        let result = process.request(request_id, method, params).await?;
        request_id += 1;
        if let Some(items) = result[result_key].as_array() {
            combined.extend(items.iter().cloned());
        }
        cursor = result["nextCursor"].as_str().map(ToString::to_string);
        if cursor.is_none() || combined.len() >= 1_000 {
            break;
        }
    }
    Ok(json!({result_key: combined}))
}

fn is_transport_error(error: &str) -> bool {
    let lower = error.to_lowercase();
    [
        "timed out",
        "closed stdout",
        "failed to read",
        "failed to write",
        "http request failed",
        "mcp http error 404",
        "connection",
        "broken pipe",
    ]
    .iter()
    .any(|marker| lower.contains(marker))
}

fn validate_negotiated_protocol(version: &str) -> Result<(), String> {
    if version.is_empty() {
        return Err("MCP initialize response omitted protocolVersion".to_string());
    }
    if !SUPPORTED_MCP_PROTOCOL_VERSIONS.contains(&version) {
        return Err(format!(
            "MCP server negotiated unsupported protocol version '{}'",
            version
        ));
    }
    Ok(())
}

async fn ensure_connected(
    connection: &mut Option<McpConnection>,
    config: &ExternalMcpServerConfig,
) -> Result<(), String> {
    if connection.is_none() {
        if config.transport == "streamable_http" {
            let mut session = HttpMcpSession::new(config)?;
            session.initialize().await?;
            *connection = Some(McpConnection::Http(session));
        } else {
            let mut process = McpProcess::spawn(config).await?;
            process.initialize().await?;
            *connection = Some(McpConnection::Stdio(process));
        }
    }
    Ok(())
}

#[cfg(target_os = "macos")]
const MCP_KEYCHAIN_SERVICE: &str = "com.labnexus.mcp";
#[cfg(target_os = "macos")]
const MCP_KEYCHAIN_ACCOUNT: &str = "server-secrets";

#[cfg(target_os = "macos")]
#[derive(Debug, Default, Serialize, Deserialize)]
struct McpSecretsBundle {
    #[serde(default)]
    env: HashMap<String, HashMap<String, String>>,
    #[serde(default)]
    headers: HashMap<String, HashMap<String, String>>,
}

pub fn load_external_mcp_config() -> Result<ExternalMcpConfigFile, String> {
    let path = external_mcp_config_path();
    if !path.exists() {
        return Ok(ExternalMcpConfigFile::default());
    }
    let content = std::fs::read_to_string(&path)
        .map_err(|error| format!("Failed to read MCP config {:?}: {}", path, error))?;
    let mut config: ExternalMcpConfigFile = serde_json::from_str(&content)
        .map_err(|error| format!("Invalid MCP config {:?}: {}", path, error))?;

    #[cfg(target_os = "macos")]
    {
        let mut bundle = crate::agent::config::load_keychain_secret(
            MCP_KEYCHAIN_SERVICE,
            MCP_KEYCHAIN_ACCOUNT,
        )
        .ok()
        .flatten()
        .and_then(|raw| serde_json::from_str::<McpSecretsBundle>(&raw).ok())
        .unwrap_or_default();

        let mut migrated_plaintext = false;
        for server in &mut config.servers {
            for (k, v) in &mut server.env {
                if !v.is_empty() {
                    bundle
                        .env
                        .entry(server.id.clone())
                        .or_default()
                        .insert(k.clone(), v.clone());
                    migrated_plaintext = true;
                } else if let Some(saved) = bundle.env.get(&server.id).and_then(|m| m.get(k)) {
                    *v = saved.clone();
                }
            }
            for (k, v) in &mut server.headers {
                if !v.is_empty() {
                    bundle
                        .headers
                        .entry(server.id.clone())
                        .or_default()
                        .insert(k.clone(), v.clone());
                    migrated_plaintext = true;
                } else if let Some(saved) = bundle.headers.get(&server.id).and_then(|m| m.get(k)) {
                    *v = saved.clone();
                }
            }
        }
        if migrated_plaintext {
            let _ = save_external_mcp_config(&config);
        }
    }

    validate_config_file(&config)?;
    Ok(config)
}

pub fn save_external_mcp_config(config: &ExternalMcpConfigFile) -> Result<(), String> {
    validate_config_file(config)?;
    let mut disk_config = config.clone();

    #[cfg(target_os = "macos")]
    {
        let mut bundle = McpSecretsBundle::default();
        for server in &mut disk_config.servers {
            for (k, v) in &mut server.env {
                if !v.is_empty() {
                    bundle
                        .env
                        .entry(server.id.clone())
                        .or_default()
                        .insert(k.clone(), v.clone());
                    v.clear();
                }
            }
            for (k, v) in &mut server.headers {
                if !v.is_empty() {
                    bundle
                        .headers
                        .entry(server.id.clone())
                        .or_default()
                        .insert(k.clone(), v.clone());
                    v.clear();
                }
            }
        }
        if let Ok(serialized) = serde_json::to_string(&bundle) {
            if let Err(err) = crate::agent::config::save_keychain_secret(
                MCP_KEYCHAIN_SERVICE,
                MCP_KEYCHAIN_ACCOUNT,
                &serialized,
            ) {
                log::warn!("Failed to store MCP secrets in Keychain: {}", err);
                disk_config = config.clone();
            }
        }
    }

    let path = external_mcp_config_path();
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|error| format!("Failed to create MCP config directory: {}", error))?;
    }
    let temporary = path.with_extension("json.tmp");
    let content = serde_json::to_string_pretty(&disk_config)
        .map_err(|error| format!("Failed to encode MCP config: {}", error))?;
    std::fs::write(&temporary, content)
        .map_err(|error| format!("Failed to write MCP config: {}", error))?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(&temporary, std::fs::Permissions::from_mode(0o600))
            .map_err(|error| format!("Failed to secure MCP config: {}", error))?;
    }
    std::fs::rename(&temporary, &path)
        .map_err(|error| format!("Failed to replace MCP config: {}", error))
}

pub fn namespace_tool_name(server_id: &str, tool_name: &str) -> String {
    format!(
        "mcp__{}__{}",
        sanitize_name(server_id),
        sanitize_name(tool_name)
    )
}

fn external_mcp_config_path() -> PathBuf {
    let home = std::env::var("HOME")
        .or_else(|_| std::env::var("USERPROFILE"))
        .unwrap_or_else(|_| ".".to_string());
    PathBuf::from(home)
        .join(".labnexus")
        .join("config")
        .join("mcp.json")
}

fn validate_server_config(config: &ExternalMcpServerConfig) -> Result<(), String> {
    if config.id.trim().is_empty()
        || !config
            .id
            .chars()
            .all(|character| character.is_ascii_alphanumeric() || matches!(character, '-' | '_'))
    {
        return Err(format!("Invalid MCP server id '{}'", config.id));
    }
    if !matches!(config.transport.as_str(), "stdio" | "streamable_http") {
        return Err(format!(
            "MCP server '{}' has unsupported transport '{}'",
            config.id, config.transport
        ));
    }
    if config.transport == "stdio" && config.command.trim().is_empty() {
        return Err(format!(
            "MCP server '{}' command cannot be empty",
            config.id
        ));
    }
    if config.transport == "streamable_http" {
        let parsed = url::Url::parse(&config.url)
            .map_err(|error| format!("Invalid MCP server URL '{}': {}", config.url, error))?;
        if !matches!(parsed.scheme(), "http" | "https") {
            return Err("MCP Streamable HTTP URL must use http or https".to_string());
        }
        for (name, value) in &config.headers {
            reqwest::header::HeaderName::from_bytes(name.as_bytes())
                .map_err(|error| format!("Invalid MCP HTTP header name '{}': {}", name, error))?;
            reqwest::header::HeaderValue::from_str(value).map_err(|error| {
                format!("Invalid MCP HTTP header value for '{}': {}", name, error)
            })?;
        }
    }
    if config.args.len() > 100 || config.env.len() > 100 || config.headers.len() > 100 {
        return Err(format!(
            "MCP server '{}' configuration is too large",
            config.id
        ));
    }
    if !(1..=120).contains(&config.timeout_seconds) {
        return Err(format!(
            "MCP server '{}' timeout must be between 1 and 120 seconds",
            config.id
        ));
    }
    Ok(())
}

fn validate_config_file(config: &ExternalMcpConfigFile) -> Result<(), String> {
    if config.servers.len() > 20 {
        return Err("At most 20 MCP servers may be configured".to_string());
    }
    if serde_json::to_vec(config)
        .map(|encoded| encoded.len())
        .unwrap_or(usize::MAX)
        > 256 * 1024
    {
        return Err("MCP configuration exceeds 256 KiB".to_string());
    }
    let mut ids = std::collections::HashSet::new();
    for server in &config.servers {
        validate_server_config(server)?;
        if !ids.insert(&server.id) {
            return Err(format!("Duplicate MCP server id '{}'", server.id));
        }
    }
    Ok(())
}

fn sanitize_name(value: &str) -> String {
    value
        .chars()
        .map(|character| {
            if character.is_ascii_alphanumeric() || matches!(character, '_' | '-') {
                character
            } else {
                '_'
            }
        })
        .take(80)
        .collect()
}

fn format_tool_result(result: &serde_json::Value) -> String {
    let mut parts = Vec::new();
    if let Some(content) = result["content"].as_array() {
        for item in content {
            match item["type"].as_str() {
                Some("text") => {
                    if let Some(text) = item["text"].as_str() {
                        parts.push(text.to_string());
                    }
                }
                Some("resource_link") | Some("resource") => parts.push(item.to_string()),
                _ => {}
            }
        }
    }
    if let Some(structured) = result.get("structuredContent") {
        parts.push(
            serde_json::to_string_pretty(structured).unwrap_or_else(|_| structured.to_string()),
        );
    }
    if parts.is_empty() {
        result.to_string()
    } else {
        parts.join("\n")
    }
}

fn default_enabled() -> bool {
    true
}

fn default_transport() -> String {
    "stdio".to_string()
}

fn default_timeout_seconds() -> u64 {
    30
}

#[cfg(test)]
mod tests {
    use super::{
        format_tool_result, namespace_tool_name, ExternalMcpClient, ExternalMcpServerConfig,
    };
    use std::collections::HashMap;

    #[test]
    fn namespaces_and_sanitizes_external_tool_names() {
        assert_eq!(
            namespace_tool_name("github.local", "search/issues"),
            "mcp__github_local__search_issues"
        );
    }

    #[test]
    fn formats_text_and_structured_tool_results() {
        let output = format_tool_result(&serde_json::json!({
            "content": [{"type": "text", "text": "ok"}],
            "structuredContent": {"count": 1}
        }));
        assert!(output.contains("ok"));
        assert!(output.contains("count"));
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn discovers_and_calls_a_local_stdio_mcp_server() {
        let directory = std::env::temp_dir().join(format!(
            "labnexus-mcp-test-{}",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        std::fs::create_dir_all(&directory).unwrap();
        let script = directory.join("mock-mcp.sh");
        std::fs::write(
            &script,
            r#"#!/bin/sh
while IFS= read -r line; do
  case "$line" in
    *'"method":"initialize"'*)
      echo '{"jsonrpc":"2.0","id":1,"result":{"protocolVersion":"2025-06-18","capabilities":{"tools":{}},"serverInfo":{"name":"mock","version":"1"}}}'
      ;;
    *'"method":"tools/list"'*)
      echo '{"jsonrpc":"2.0","id":2,"result":{"tools":[{"name":"echo","description":"Echo input","inputSchema":{"type":"object","properties":{"value":{"type":"string"}},"required":["value"]}}]}}'
      ;;
    *'"method":"tools/call"'*)
      echo '{"jsonrpc":"2.0","method":"notifications/tools/list_changed"}'
      echo '{"jsonrpc":"2.0","id":2,"result":{"content":[{"type":"text","text":"mock result"}],"isError":false}}'
      ;;
    *'"method":"resources/list"'*)
      echo '{"jsonrpc":"2.0","id":2,"result":{"resources":[{"uri":"mock://data","name":"Mock data"}]}}'
      ;;
    *'"method":"resources/read"'*)
      echo '{"jsonrpc":"2.0","id":2,"result":{"contents":[{"uri":"mock://data","text":"resource body"}]}}'
      ;;
    *'"method":"prompts/list"'*)
      echo '{"jsonrpc":"2.0","id":2,"result":{"prompts":[{"name":"review"}]}}'
      ;;
    *'"method":"prompts/get"'*)
      echo '{"jsonrpc":"2.0","id":2,"result":{"messages":[{"role":"user","content":{"type":"text","text":"review it"}}]}}'
      ;;
  esac
done
"#,
        )
        .unwrap();

        let client = ExternalMcpClient::new(ExternalMcpServerConfig {
            id: "mock".to_string(),
            name: "Mock MCP".to_string(),
            transport: "stdio".to_string(),
            command: "/bin/sh".to_string(),
            args: vec![script.to_string_lossy().to_string()],
            env: HashMap::new(),
            url: String::new(),
            headers: HashMap::new(),
            enabled: true,
            timeout_seconds: 3,
        });
        let tools = client.list_tools().await.unwrap();
        assert_eq!(tools.len(), 1);
        assert_eq!(tools[0].name, "echo");
        let output = client
            .call_tool("echo", &serde_json::json!({"value": "hello"}))
            .await
            .unwrap();
        assert_eq!(output, "mock result");
        assert!(client.take_tools_changed().await);
        assert_eq!(
            client.list_resources().await.unwrap()["resources"][0]["uri"],
            "mock://data"
        );
        assert_eq!(
            client.read_resource("mock://data").await.unwrap()["contents"][0]["text"],
            "resource body"
        );
        assert_eq!(
            client.list_prompts().await.unwrap()["prompts"][0]["name"],
            "review"
        );
        assert_eq!(
            client
                .get_prompt("review", serde_json::json!({}))
                .await
                .unwrap()["messages"][0]["role"],
            "user"
        );

        let _ = std::fs::remove_dir_all(directory);
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn times_out_when_a_stdio_server_does_not_respond() {
        let client = ExternalMcpClient::new(ExternalMcpServerConfig {
            id: "silent".to_string(),
            name: "Silent MCP".to_string(),
            transport: "stdio".to_string(),
            command: "/bin/sh".to_string(),
            args: vec![
                "-c".to_string(),
                "while IFS= read -r line; do :; done".to_string(),
            ],
            env: HashMap::new(),
            url: String::new(),
            headers: HashMap::new(),
            enabled: true,
            timeout_seconds: 1,
        });
        let error = client.list_tools().await.unwrap_err();
        assert!(error.contains("timed out"));
    }

    #[tokio::test]
    async fn supports_streamable_http_json_responses_and_session_ids() {
        use tokio::io::{AsyncReadExt, AsyncWriteExt};
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        let server = tokio::spawn(async move {
            for request_index in 0..3 {
                let (mut socket, _) = listener.accept().await.unwrap();
                let mut request = Vec::new();
                let mut buffer = [0_u8; 2048];
                loop {
                    let count = socket.read(&mut buffer).await.unwrap();
                    request.extend_from_slice(&buffer[..count]);
                    if request.windows(4).any(|window| window == b"\r\n\r\n") {
                        break;
                    }
                }
                let header_end = request
                    .windows(4)
                    .position(|window| window == b"\r\n\r\n")
                    .unwrap()
                    + 4;
                let headers = String::from_utf8_lossy(&request[..header_end]);
                if request_index > 0 {
                    assert!(headers
                        .to_ascii_lowercase()
                        .contains("mcp-protocol-version: 2025-06-18"));
                }
                let content_length = headers
                    .lines()
                    .find_map(|line| {
                        line.to_ascii_lowercase()
                            .strip_prefix("content-length:")?
                            .trim()
                            .parse::<usize>()
                            .ok()
                    })
                    .unwrap_or(0);
                while request.len() < header_end + content_length {
                    let count = socket.read(&mut buffer).await.unwrap();
                    request.extend_from_slice(&buffer[..count]);
                }
                let body = String::from_utf8_lossy(&request[header_end..]);
                let (status, response_body) = if body.contains("notifications/initialized") {
                    ("202 Accepted", String::new())
                } else if body.contains("\"method\":\"initialize\"") {
                    ("200 OK", "{\"jsonrpc\":\"2.0\",\"id\":1,\"result\":{\"protocolVersion\":\"2025-06-18\",\"capabilities\":{\"tools\":{}}}}".to_string())
                } else {
                    ("200 OK", "{\"jsonrpc\":\"2.0\",\"id\":2,\"result\":{\"tools\":[{\"name\":\"http_echo\",\"inputSchema\":{\"type\":\"object\"}}]}}".to_string())
                };
                let response = format!(
                    "HTTP/1.1 {}\r\nContent-Type: application/json\r\nMcp-Session-Id: test-session\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
                    status,
                    response_body.len(),
                    response_body
                );
                socket.write_all(response.as_bytes()).await.unwrap();
            }
        });
        let client = ExternalMcpClient::new(ExternalMcpServerConfig {
            id: "http".to_string(),
            name: "HTTP MCP".to_string(),
            transport: "streamable_http".to_string(),
            command: String::new(),
            args: vec![],
            env: HashMap::new(),
            url: format!("http://{}/mcp", address),
            headers: HashMap::new(),
            enabled: true,
            timeout_seconds: 3,
        });
        let tools = client.list_tools().await.unwrap();
        assert_eq!(tools[0].name, "http_echo");
        server.await.unwrap();
    }
}
