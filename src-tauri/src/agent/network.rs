//! AI-only networking. Remote API and ChatGPT can use separate routes.
use super::config::get_config_path;
use crate::error::AppError;
use reqwest::{ClientBuilder, NoProxy, Proxy};
use serde::{Deserialize, Serialize};
use std::{
    fs,
    net::IpAddr,
    time::{Duration, Instant},
};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Hash)]
#[serde(default)]
pub struct AiProxyConfig {
    pub mode: String, // system | manual | direct
    pub url: String,
}
impl Default for AiProxyConfig {
    fn default() -> Self {
        Self {
            mode: "system".into(),
            url: "http://127.0.0.1:7890".into(),
        }
    }
}
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(default)]
pub struct AiNetworkConfig {
    pub remote: AiProxyConfig,
    pub chatgpt: AiProxyConfig,
}
impl AiNetworkConfig {
    pub fn for_auth(&self, auth_mode: &str) -> &AiProxyConfig {
        if auth_mode == "chatgpt" {
            &self.chatgpt
        } else {
            &self.remote
        }
    }
    pub fn validate(&self) -> Result<(), AppError> {
        validate_proxy(&self.remote)?;
        validate_proxy(&self.chatgpt)
    }
}
fn proxy_error(message: &str) -> AppError {
    AppError::Agent(format!("AI proxy: {}", message))
}
pub fn validate_proxy(config: &AiProxyConfig) -> Result<(), AppError> {
    if !matches!(config.mode.as_str(), "system" | "manual" | "direct") {
        return Err(proxy_error("unsupported proxy mode"));
    }
    if config.mode != "manual" {
        return Ok(());
    }
    let url = url::Url::parse(config.url.trim())
        .map_err(|_| proxy_error("enter a valid proxy URL, for example http://127.0.0.1:7890"))?;
    if !matches!(url.scheme(), "http" | "https" | "socks5" | "socks5h")
        || url.host_str().is_none()
        || url.port_or_known_default().is_none_or(|port| port == 0)
    {
        return Err(proxy_error(
            "use an HTTP, HTTPS, SOCKS5 or SOCKS5H URL with a valid host and port",
        ));
    }
    if !url.username().is_empty() || url.password().is_some() {
        return Err(proxy_error(
            "proxy credentials in URLs are not supported; use a local proxy without authentication",
        ));
    }
    if !matches!(url.path(), "" | "/") || url.query().is_some() || url.fragment().is_some() {
        return Err(proxy_error(
            "a proxy URL must not contain a path, query or fragment",
        ));
    }
    Ok(())
}
pub fn is_loopback(target: &str) -> bool {
    url::Url::parse(target)
        .ok()
        .is_some_and(|url| match url.host() {
            Some(url::Host::Domain(host)) => {
                host.trim_end_matches('.').eq_ignore_ascii_case("localhost")
            }
            Some(url::Host::Ipv4(ip)) => IpAddr::V4(ip).is_loopback(),
            Some(url::Host::Ipv6(ip)) => IpAddr::V6(ip).is_loopback(),
            None => false,
        })
}
pub fn client_builder(config: &AiProxyConfig, target: &str) -> Result<ClientBuilder, AppError> {
    validate_proxy(config)?;
    let builder = reqwest::Client::builder().connect_timeout(Duration::from_secs(10));
    if is_loopback(target) || config.mode == "direct" {
        return Ok(builder.no_proxy());
    }
    if config.mode == "manual" {
        let proxy = Proxy::all(config.url.trim())
            .map_err(|_| proxy_error("unable to initialize proxy"))?
            .no_proxy(NoProxy::from_string("localhost,127.0.0.0/8,::1"));
        // An invalid explicit route must never fall back to a system proxy or direct.
        Ok(builder.no_proxy().proxy(proxy))
    } else {
        Ok(builder)
    }
}
/// Read only network settings: OAuth public-key requests must not load API keys from Keychain.
pub fn load_network_config() -> Result<AiNetworkConfig, AppError> {
    #[derive(Deserialize)]
    struct Envelope {
        #[serde(default)]
        network: AiNetworkConfig,
    }
    match fs::read(get_config_path()) {
        Ok(bytes) => {
            let envelope: Envelope = serde_json::from_slice(&bytes)
                .map_err(|_| proxy_error("unable to read saved network configuration"))?;
            envelope.network.validate()?;
            Ok(envelope.network)
        }
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            Ok(AiNetworkConfig::default())
        }
        Err(_) => Err(proxy_error("unable to read saved network configuration")),
    }
}

#[derive(Serialize)]
pub struct AiProxyTestResult {
    pub target: String,
    pub reachable: bool,
    pub status: Option<u16>,
    pub latency_ms: u64,
    pub detail: String,
}
fn catalog_url(base: &str) -> Result<String, AppError> {
    let mut base = url::Url::parse(base.trim()).map_err(|_| proxy_error("invalid API base URL"))?;
    if !matches!(base.scheme(), "http" | "https") || base.host_str().is_none() {
        return Err(proxy_error("API base URL must use HTTP or HTTPS"));
    }
    // Connectivity probes intentionally carry no credentials, query parameters or API keys.
    let _ = base.set_username("");
    let _ = base.set_password(None);
    base.set_query(None);
    base.set_fragment(None);
    let path = base.path().trim_end_matches('/');
    let path = path
        .strip_suffix("/responses")
        .or_else(|| path.strip_suffix("/chat/completions"))
        .unwrap_or(path);
    let path = if base.host_str() == Some("api.openai.com") && path.is_empty() {
        "/v1"
    } else {
        path
    };
    base.set_path(&format!("{}/models", path));
    Ok(base.to_string())
}
pub async fn test_proxy(
    route: &str,
    config: &AiProxyConfig,
    base_url: &str,
) -> Result<Vec<AiProxyTestResult>, AppError> {
    let targets = match route {
        "chatgpt" => vec![
            "https://auth.openai.com/.well-known/openid-configuration".into(),
            "https://api.openai.com/v1/models".into(),
        ],
        "remote" => vec![catalog_url(base_url)?],
        _ => return Err(proxy_error("unsupported connection-test target")),
    };
    let mut results = Vec::new();
    for target in targets {
        let client = client_builder(config, &target)?
            .redirect(reqwest::redirect::Policy::none())
            .timeout(Duration::from_secs(12))
            .build()
            .map_err(|_| proxy_error("unable to initialize connection test"))?;
        let start = Instant::now();
        let (reachable, status, detail) = match client.get(&target).send().await {
            Ok(response) => {
                let status = response.status();
                let reachable = status.is_success() || status.as_u16() == 401;
                let detail = if status.as_u16() == 407 {
                    "Proxy authentication required"
                } else if reachable {
                    "Connection established; model access and account eligibility are not checked"
                } else {
                    "Server responded, but the endpoint is unavailable or denied the request"
                };
                (reachable, Some(status.as_u16()), detail.into())
            }
            Err(error) => {
                // Do not expose proxy URLs or request internals in diagnostics.
                let detail = if error.is_timeout() {
                    "Connection timed out"
                } else if error.is_connect() {
                    "Connection failed; check proxy port, VPN routing, DNS and TLS certificates"
                } else {
                    "Unable to complete connection test"
                };
                (false, None, detail.into())
            }
        };
        results.push(AiProxyTestResult {
            target,
            reachable,
            status,
            latency_ms: start.elapsed().as_millis() as u64,
            detail,
        });
    }
    Ok(results)
}

#[cfg(test)]
mod tests {
    use super::*;
    use tokio::{
        io::{AsyncReadExt, AsyncWriteExt},
        net::TcpListener,
    };
    fn manual(url: &str) -> AiProxyConfig {
        AiProxyConfig {
            mode: "manual".into(),
            url: url.into(),
        }
    }

    #[test]
    fn validates_proxy_urls_and_keeps_routes_independent() {
        for url in [
            "http://127.0.0.1:7890",
            "https://proxy.example:8443",
            "socks5://127.0.0.1:1080",
            "socks5h://[::1]:1080",
        ] {
            assert!(validate_proxy(&manual(url)).is_ok(), "{}", url);
        }
        for url in [
            "not a url",
            "ftp://127.0.0.1:21",
            "http://127.0.0.1:0",
            "http://proxy.example:7890/path",
            "http://user:password@proxy.example:7890",
            "http://proxy.example:7890?token=private",
            "http://proxy.example:7890#fragment",
        ] {
            assert!(validate_proxy(&manual(url)).is_err(), "{}", url);
        }
        let mut config = AiNetworkConfig::default();
        config.chatgpt = manual("socks5h://127.0.0.1:7891");
        assert_eq!(config.for_auth("api_key").mode, "system");
        assert_eq!(config.for_auth("chatgpt").url, "socks5h://127.0.0.1:7891");
        let restored: AiNetworkConfig =
            serde_json::from_value(serde_json::json!({"chatgpt":{"mode":"direct"}})).unwrap();
        assert_eq!(restored.remote.mode, "system");
        assert_eq!(restored.chatgpt.mode, "direct");
        assert!(validate_proxy(&AiProxyConfig {
            mode: "unknown".into(),
            url: String::new()
        })
        .is_err());
    }
    #[test]
    fn recognizes_loopback_and_sanitizes_probe_targets() {
        for target in [
            "http://localhost:11434",
            "http://LOCALHOST.:11434",
            "http://127.0.0.1:11434",
            "http://127.10.2.3:11434",
            "http://[::1]:11434",
        ] {
            assert!(is_loopback(target));
        }
        for target in [
            "https://localhost.example",
            "https://api.openai.com",
            "http://192.168.1.1",
        ] {
            assert!(!is_loopback(target));
        }
        assert_eq!(
            catalog_url("https://api.openai.com").unwrap(),
            "https://api.openai.com/v1/models"
        );
        assert_eq!(
            catalog_url("https://example.test/v1/chat/completions").unwrap(),
            "https://example.test/v1/models"
        );
        assert_eq!(
            catalog_url("https://name:password@example.test/v1/responses?secret=hidden#fragment")
                .unwrap(),
            "https://example.test/v1/models"
        );
    }
    async fn reply(listener: TcpListener, status: &str, body: &str) -> Vec<u8> {
        let (mut socket, _) = tokio::time::timeout(Duration::from_secs(5), listener.accept())
            .await
            .unwrap()
            .unwrap();
        let mut request = Vec::new();
        let mut buffer = [0u8; 4096];
        let end = loop {
            let n = socket.read(&mut buffer).await.unwrap();
            assert!(n > 0);
            request.extend_from_slice(&buffer[..n]);
            if let Some(end) = request.windows(4).position(|chunk| chunk == b"\r\n\r\n") {
                break end + 4;
            }
        };
        let headers = String::from_utf8_lossy(&request[..end]);
        let length = headers
            .lines()
            .find_map(|line| {
                line.to_ascii_lowercase()
                    .strip_prefix("content-length:")
                    .and_then(|n| n.trim().parse::<usize>().ok())
            })
            .unwrap_or(0);
        while request.len() < end + length {
            let n = socket.read(&mut buffer).await.unwrap();
            assert!(n > 0);
            request.extend_from_slice(&buffer[..n]);
        }
        let response=format!("HTTP/1.1 {}\r\nContent-Type: text/event-stream\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",status,body.len(),body);
        socket.write_all(response.as_bytes()).await.unwrap();
        request
    }
    #[tokio::test]
    async fn manual_http_probe_uses_proxy_without_sending_credentials() {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        let server = tokio::spawn(async move { reply(listener, "401 Unauthorized", "").await });
        let proxy = manual(&format!("http://{}", address));
        let result = test_proxy(
            "remote",
            &proxy,
            "http://user:password@ai.invalid/v1/responses?key=hidden",
        )
        .await
        .unwrap();
        assert!(result[0].reachable);
        assert_eq!(result[0].status, Some(401));
        let request = String::from_utf8(server.await.unwrap()).unwrap();
        assert!(request.starts_with("GET http://ai.invalid/v1/models HTTP/1.1"));
        assert!(!request.to_ascii_lowercase().contains("authorization:"));
        assert!(!request.contains("password") && !request.contains("hidden"));
    }
    #[tokio::test]
    async fn loopback_stays_direct_even_with_an_unavailable_manual_proxy() {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        let dead = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let dead_address = dead.local_addr().unwrap();
        drop(dead);
        let server = tokio::spawn(async move { reply(listener, "200 OK", "ok").await });
        let target = format!("http://{}/models", address);
        let client = client_builder(&manual(&format!("http://{}", dead_address)), &target)
            .unwrap()
            .build()
            .unwrap();
        assert_eq!(client.get(&target).send().await.unwrap().status(), 200);
        assert!(String::from_utf8(server.await.unwrap())
            .unwrap()
            .starts_with("GET /models HTTP/1.1"));
    }
    #[tokio::test]
    async fn socks5h_sends_hostname_to_proxy_instead_of_resolving_locally() {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        let server = tokio::spawn(async move {
            let (mut socket, _) = tokio::time::timeout(Duration::from_secs(5), listener.accept())
                .await
                .unwrap()
                .unwrap();
            let mut hello = [0u8; 2];
            socket.read_exact(&mut hello).await.unwrap();
            assert_eq!(hello[0], 5);
            let mut methods = vec![0u8; hello[1] as usize];
            socket.read_exact(&mut methods).await.unwrap();
            socket.write_all(&[5, 0]).await.unwrap();
            let mut connect = [0u8; 4];
            socket.read_exact(&mut connect).await.unwrap();
            assert_eq!(connect, [5, 1, 0, 3]);
            let mut length = [0u8; 1];
            socket.read_exact(&mut length).await.unwrap();
            let mut host = vec![0u8; length[0] as usize];
            socket.read_exact(&mut host).await.unwrap();
            let mut port = [0u8; 2];
            socket.read_exact(&mut port).await.unwrap();
            socket
                .write_all(&[5, 5, 0, 1, 0, 0, 0, 0, 0, 0])
                .await
                .unwrap();
            (String::from_utf8(host).unwrap(), u16::from_be_bytes(port))
        });
        let target = "http://model.invalid/models";
        let client = client_builder(&manual(&format!("socks5h://{}", address)), target)
            .unwrap()
            .build()
            .unwrap();
        assert!(client.get(target).send().await.is_err());
        let (host, port) = server.await.unwrap();
        assert_eq!(host, "model.invalid");
        assert_eq!(port, 80);
    }
    #[tokio::test]
    async fn llm_requests_use_live_api_proxy_settings_and_rebuild_on_change() {
        let client = crate::agent::llm::LlmClient::new();
        let mut config = crate::agent::AiConfig::default();
        config.remote.base_url = "http://model.invalid/v1".into();
        config.remote.api_key = "test-only-key".into();
        config.resilience.max_retries = 0;
        config.resilience.fallback_enabled = false;
        // A separate, unusable ChatGPT route must not affect the API-key route.
        config.network.chatgpt = manual("http://127.0.0.1:1");
        for answer in ["first-proxy", "second-proxy"] {
            let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
            let address = listener.local_addr().unwrap();
            config.network.remote = manual(&format!("http://{}", address));
            let body = format!(
                "data: {}\n\n",
                serde_json::json!({"type":"response.completed","response":{"status":"completed","output":[{"type":"message","role":"assistant","content":[{"type":"output_text","text":answer}]}],"usage":{"input_tokens":1,"output_tokens":1}}})
            );
            let server = tokio::spawn(async move { reply(listener, "200 OK", &body).await });
            let result = client
                .stream_chat(
                    &config,
                    &[crate::agent::AgentMessage::user("hi")],
                    &[],
                    |_| {},
                )
                .await
                .unwrap();
            assert_eq!(result.message.content, answer);
            let request = String::from_utf8(server.await.unwrap()).unwrap();
            assert!(request.starts_with("POST http://model.invalid/v1/responses HTTP/1.1"));
        }
        client.reset_network().await;
    }
}
