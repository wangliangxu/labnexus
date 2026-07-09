//! Jupyter Client — HTTP connection management with proxy support.
//!
//! Handles connecting to remote Jupyter servers, including through
//! SOCKS5 proxies (e.g., SSH -D tunnels) and HTTP proxies.

use reqwest::{Client, Proxy};
use url::Url;

use crate::error::AppError;
use crate::jupyter::types::*;

/// A client for communicating with a single remote Jupyter server.
#[derive(Debug, Clone)]
pub struct JupyterClient {
    /// HTTP client (configured with proxy if needed).
    http: Client,
    /// Base URL of the Jupyter server.
    base_url: Url,
    /// Auth token for the server.
    token: Option<String>,
    /// Server ID (for multi-server management).
    server_id: String,
}

/// Build a reqwest::Client configured with optional proxy support.
pub fn build_http_client(proxy_config: Option<&ProxyConfig>) -> Result<Client, AppError> {
    let mut client_builder = Client::builder()
        .timeout(std::time::Duration::from_secs(30))
        .connect_timeout(std::time::Duration::from_secs(10));

    if let Some(proxy_config) = proxy_config {
        let proxy_url = match proxy_config.proxy_type {
            ProxyType::Socks5 => {
                if let (Some(user), Some(pass)) = (&proxy_config.username, &proxy_config.password) {
                    format!(
                        "socks5://{}:{}@{}:{}",
                        user, pass, proxy_config.host, proxy_config.port
                    )
                } else {
                    format!("socks5://{}:{}", proxy_config.host, proxy_config.port)
                }
            }
            ProxyType::Http => {
                format!("http://{}:{}", proxy_config.host, proxy_config.port)
            }
            ProxyType::Https => {
                format!("https://{}:{}", proxy_config.host, proxy_config.port)
            }
        };

        let proxy = Proxy::all(&proxy_url)
            .map_err(|e| AppError::Proxy(format!("Failed to configure proxy: {}", e)))?;
        client_builder = client_builder.proxy(proxy);
    }

    client_builder
        .build()
        .map_err(|e| AppError::JupyterConnection(format!("Failed to build HTTP client: {}", e)))
}

impl JupyterClient {
    /// Create a new JupyterClient from a server configuration.
    pub fn new(config: &JupyterServerConfig) -> Result<Self, AppError> {
        let base_url = Url::parse(&config.base_url)
            .map_err(|e| AppError::JupyterConnection(format!("Invalid URL: {}", e)))?;

        let http = build_http_client(config.proxy.as_ref())?;

        Ok(JupyterClient {
            http,
            base_url,
            token: config.token.clone(),
            server_id: config.id.clone(),
        })
    }

    /// Get the server ID.
    pub fn server_id(&self) -> &str {
        &self.server_id
    }

    /// Build a full URL for an API endpoint.
    fn api_url(&self, path: &str) -> Result<Url, AppError> {
        let base_str = self.base_url.as_str().trim_end_matches('/');
        let relative_path = path.trim_start_matches('/');
        let full_url_str = format!("{}/{}", base_str, relative_path);
        Url::parse(&full_url_str)
            .map_err(|e| AppError::JupyterConnection(format!("Failed to construct API URL: {}", e)))
    }

    /// Build a GET request with authentication.
    fn get(&self, path: &str) -> Result<reqwest::RequestBuilder, AppError> {
        let url = self.api_url(path)?;
        let mut req = self.http.get(url);
        if let Some(token) = &self.token {
            req = req.header("Authorization", format!("token {}", token));
        }
        Ok(req)
    }

    /// Build a POST request with authentication.
    fn post(&self, path: &str) -> Result<reqwest::RequestBuilder, AppError> {
        let url = self.api_url(path)?;
        let mut req = self.http.post(url);
        if let Some(token) = &self.token {
            req = req.header("Authorization", format!("token {}", token));
        }
        Ok(req)
    }

    /// Build a PUT request with authentication.
    fn put(&self, path: &str) -> Result<reqwest::RequestBuilder, AppError> {
        let url = self.api_url(path)?;
        let mut req = self.http.put(url);
        if let Some(token) = &self.token {
            req = req.header("Authorization", format!("token {}", token));
        }
        Ok(req)
    }

    /// Build a DELETE request with authentication.
    fn delete(&self, path: &str) -> Result<reqwest::RequestBuilder, AppError> {
        let url = self.api_url(path)?;
        let mut req = self.http.delete(url);
        if let Some(token) = &self.token {
            req = req.header("Authorization", format!("token {}", token));
        }
        Ok(req)
    }

    /// Build a PATCH request with authentication.
    fn patch(&self, path: &str) -> Result<reqwest::RequestBuilder, AppError> {
        let url = self.api_url(path)?;
        let mut req = self.http.patch(url);
        if let Some(token) = &self.token {
            req = req.header("Authorization", format!("token {}", token));
        }
        Ok(req)
    }

    /// Parse an API response, converting HTTP errors to AppError.
    async fn parse_response<T: serde::de::DeserializeOwned>(
        &self,
        response: reqwest::Response,
    ) -> Result<T, AppError> {
        let status = response.status();
        if !status.is_success() {
            let message = response
                .text()
                .await
                .unwrap_or_else(|_| "Unknown error".to_string());
            return Err(AppError::JupyterApi {
                status: status.as_u16(),
                message,
            });
        }
        response
            .json::<T>()
            .await
            .map_err(|e| AppError::Serialization(format!("Failed to parse response: {}", e)))
    }

    // ─── Server Info ───────────────────────────────────────────────

    /// Test connection and retrieve server information.
    pub async fn get_server_info(&self) -> Result<ServerInfo, AppError> {
        let response = self.get("/api")?.send().await?;
        self.parse_response(response).await
    }

    // ─── Contents API ──────────────────────────────────────────────

    /// List contents of a directory.
    pub async fn list_contents(&self, path: &str) -> Result<ContentItem, AppError> {
        let api_path = if path.is_empty() || path == "/" {
            "/api/contents".to_string()
        } else {
            format!("/api/contents/{}", path.trim_start_matches('/'))
        };
        let response = self.get(&api_path)?.send().await?;
        self.parse_response(response).await
    }

    /// Get a specific file or notebook.
    pub async fn get_content(&self, path: &str) -> Result<ContentItem, AppError> {
        let api_path = format!("/api/contents/{}", path.trim_start_matches('/'));
        let response = self.get(&api_path)?.send().await?;
        self.parse_response(response).await
    }

    /// Save/update a file or notebook.
    pub async fn save_content(
        &self,
        path: &str,
        content: &serde_json::Value,
    ) -> Result<ContentItem, AppError> {
        let api_path = format!("/api/contents/{}", path.trim_start_matches('/'));
        let response = self.put(&api_path)?.json(content).send().await?;
        self.parse_response(response).await
    }

    /// Create a new file or directory.
    pub async fn create_content(
        &self,
        path: &str,
        content_type: &str, // "notebook", "file", or "directory"
    ) -> Result<ContentItem, AppError> {
        let api_path = if path.is_empty() || path == "/" {
            "/api/contents".to_string()
        } else {
            format!("/api/contents/{}", path.trim_start_matches('/'))
        };
        let body = serde_json::json!({ "type": content_type });
        let response = self.post(&api_path)?.json(&body).send().await?;
        self.parse_response(response).await
    }

    /// Delete a file or directory.
    pub async fn delete_content(&self, path: &str) -> Result<(), AppError> {
        let api_path = format!("/api/contents/{}", path.trim_start_matches('/'));
        let response = self.delete(&api_path)?.send().await?;
        let status = response.status();
        if !status.is_success() {
            let message = response
                .text()
                .await
                .unwrap_or_else(|_| "Unknown error".to_string());
            return Err(AppError::JupyterApi {
                status: status.as_u16(),
                message,
            });
        }
        Ok(())
    }

    // ─── Kernels API ───────────────────────────────────────────────

    /// List running kernels.
    pub async fn list_kernels(&self) -> Result<Vec<KernelInfo>, AppError> {
        let response = self.get("/api/kernels")?.send().await?;
        self.parse_response(response).await
    }

    /// Start a new kernel.
    pub async fn start_kernel(&self, kernel_name: &str) -> Result<KernelInfo, AppError> {
        let body = serde_json::json!({ "name": kernel_name });
        let response = self.post("/api/kernels")?.json(&body).send().await?;
        self.parse_response(response).await
    }

    /// Shutdown a kernel.
    pub async fn shutdown_kernel(&self, kernel_id: &str) -> Result<(), AppError> {
        let api_path = format!("/api/kernels/{}", kernel_id);
        let response = self.delete(&api_path)?.send().await?;
        let status = response.status();
        if !status.is_success() {
            let message = response
                .text()
                .await
                .unwrap_or_else(|_| "Unknown error".to_string());
            return Err(AppError::JupyterApi {
                status: status.as_u16(),
                message,
            });
        }
        Ok(())
    }

    /// Interrupt a running kernel.
    pub async fn interrupt_kernel(&self, kernel_id: &str) -> Result<(), AppError> {
        let api_path = format!("/api/kernels/{}/interrupt", kernel_id);
        let response = self.post(&api_path)?.send().await?;
        let status = response.status();
        if !status.is_success() {
            let message = response
                .text()
                .await
                .unwrap_or_else(|_| "Unknown error".to_string());
            return Err(AppError::JupyterApi {
                status: status.as_u16(),
                message,
            });
        }
        Ok(())
    }

    /// Restart a kernel.
    pub async fn restart_kernel(&self, kernel_id: &str) -> Result<(), AppError> {
        let api_path = format!("/api/kernels/{}/restart", kernel_id);
        let response = self.post(&api_path)?.send().await?;
        let status = response.status();
        if !status.is_success() {
            let message = response
                .text()
                .await
                .unwrap_or_else(|_| "Unknown error".to_string());
            return Err(AppError::JupyterApi {
                status: status.as_u16(),
                message,
            });
        }
        Ok(())
    }

    // ─── Sessions API ──────────────────────────────────────────────

    /// List active sessions.
    pub async fn list_sessions(&self) -> Result<Vec<SessionInfo>, AppError> {
        let response = self.get("/api/sessions")?.send().await?;
        self.parse_response(response).await
    }

    /// Create a new session (associates a notebook with a kernel).
    pub async fn create_session(
        &self,
        path: &str,
        kernel_name: &str,
    ) -> Result<SessionInfo, AppError> {
        let body = CreateSessionRequest {
            path: path.to_string(),
            name: path.split('/').last().unwrap_or(path).to_string(),
            session_type: "notebook".to_string(),
            kernel: CreateKernelRequest {
                name: kernel_name.to_string(),
            },
        };
        let response = self.post("/api/sessions")?.json(&body).send().await?;
        self.parse_response(response).await
    }

    /// Delete a session.
    pub async fn delete_session(&self, session_id: &str) -> Result<(), AppError> {
        let api_path = format!("/api/sessions/{}", session_id);
        let response = self.delete(&api_path)?.send().await?;
        let status = response.status();
        if !status.is_success() {
            let message = response
                .text()
                .await
                .unwrap_or_else(|_| "Unknown error".to_string());
            return Err(AppError::JupyterApi {
                status: status.as_u16(),
                message,
            });
        }
        Ok(())
    }

    // ─── WebSocket URL ─────────────────────────────────────────────

    /// Get the WebSocket URL for a kernel's channels endpoint.
    pub fn kernel_ws_url(&self, kernel_id: &str) -> Result<String, AppError> {
        let mut ws_url = self.base_url.clone();

        // Convert http(s) scheme to ws(s)
        match ws_url.scheme() {
            "http" => ws_url.set_scheme("ws").unwrap(),
            "https" => ws_url.set_scheme("wss").unwrap(),
            _ => {}
        }

        let base_path = ws_url.path().trim_end_matches('/');
        let path = format!("{}/api/kernels/{}/channels", base_path, kernel_id);
        ws_url.set_path(&path);

        // Add token as query parameter for WebSocket auth
        if let Some(token) = &self.token {
            ws_url.set_query(Some(&format!("token={}", token)));
        }

        Ok(ws_url.to_string())
    }

    // ─── Terminals API ─────────────────────────────────────────────

    /// List active terminal sessions.
    pub async fn list_terminals(&self) -> Result<Vec<super::types::TerminalInfo>, AppError> {
        let response = self.get("/api/terminals")?.send().await?;
        self.parse_response(response).await
    }

    /// Create a new terminal session.
    pub async fn create_terminal(&self) -> Result<super::types::TerminalInfo, AppError> {
        let response = self.post("/api/terminals")?.send().await?;
        self.parse_response(response).await
    }

    /// Delete a terminal session.
    pub async fn delete_terminal(&self, name: &str) -> Result<(), AppError> {
        let api_path = format!("/api/terminals/{}", name);
        let response = self.delete(&api_path)?.send().await?;
        let status = response.status();
        if !status.is_success() {
            let message = response
                .text()
                .await
                .unwrap_or_else(|_| "Unknown error".to_string());
            return Err(AppError::JupyterApi {
                status: status.as_u16(),
                message,
            });
        }
        Ok(())
    }

    /// Get the WebSocket URL for a terminal's channels endpoint.
    pub fn terminal_ws_url(&self, name: &str) -> Result<String, AppError> {
        let mut ws_url = self.base_url.clone();

        match ws_url.scheme() {
            "http" => ws_url.set_scheme("ws").unwrap(),
            "https" => ws_url.set_scheme("wss").unwrap(),
            _ => {}
        }

        let base_path = ws_url.path().trim_end_matches('/');
        let path = format!("{}/terminals/websocket/{}", base_path, name);
        ws_url.set_path(&path);

        if let Some(token) = &self.token {
            ws_url.set_query(Some(&format!("token={}", token)));
        }

        Ok(ws_url.to_string())
    }
}
