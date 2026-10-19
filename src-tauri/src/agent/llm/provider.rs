//! LabNexus — Unified LLM Provider client.
//!
//! Handles OpenAI-compatible APIs (DeepSeek, OpenAI) and Local Ollama / llama.cpp HTTP APIs
//! with real-time SSE streaming for text and tool calls.

use super::responses::{build_responses_payload, read_responses_stream, remote_endpoint};
use crate::agent::config::AiConfig;
use crate::agent::types::*;
use crate::error::AppError;
use reqwest::Client;
use serde_json::json;
use std::collections::HashMap;
use std::sync::Arc;
use std::time::Duration;
use tokio::sync::Mutex;
use tokio::time::Instant;

#[derive(Debug, Clone, Default)]
pub struct LlmUsage {
    pub prompt_tokens: u64,
    pub completion_tokens: u64,
    pub reasoning_chars: u64,
}

pub struct LlmChatResult {
    pub message: AgentMessage,
    pub usage: LlmUsage,
    pub provider: String,
    pub model: String,
}

/// Unified client for interacting with AI models over HTTP.
#[derive(Clone)]
pub struct LlmClient {
    http: Client,
    direct_http: Client,
    remote_http: Arc<Mutex<Option<(crate::agent::network::AiProxyConfig, bool, Client)>>>,
    circuits: Arc<Mutex<HashMap<String, CircuitState>>>,
}

#[derive(Debug, Clone)]
struct CircuitState {
    consecutive_failures: u32,
    open_until: Option<Instant>,
}

impl Default for LlmClient {
    fn default() -> Self {
        Self::new()
    }
}

impl LlmClient {
    pub fn new() -> Self {
        Self {
            http: Client::builder()
                .timeout(Duration::from_secs(300))
                .build()
                .unwrap_or_default(),
            direct_http: Client::builder()
                .no_proxy()
                .timeout(Duration::from_secs(300))
                .build()
                .expect("Unable to initialize direct AI HTTP client"),
            remote_http: Arc::new(Mutex::new(None)),
            circuits: Arc::new(Mutex::new(HashMap::new())),
        }
    }

    /// Send a chat completion request to the configured LLM provider.
    /// Streams text deltas in real-time via `on_chunk`.
    /// Returns the complete final message (including accumulated text and tool calls).
    pub async fn stream_chat<F>(
        &self,
        config: &AiConfig,
        messages: &[AgentMessage],
        tools: &[ToolDefinition],
        on_chunk: F,
    ) -> Result<LlmChatResult, AppError>
    where
        F: FnMut(&str) + Send,
    {
        self.stream_chat_with_thoughts(config, messages, tools, |_| {}, on_chunk)
            .await
    }

    /// Send a chat completion request and stream both internal reasoning (`on_thought`)
    /// and visible answer deltas (`on_chunk`) in real-time.
    pub async fn stream_chat_with_thoughts<FT, FC>(
        &self,
        config: &AiConfig,
        messages: &[AgentMessage],
        tools: &[ToolDefinition],
        mut on_thought: FT,
        mut on_chunk: FC,
    ) -> Result<LlmChatResult, AppError>
    where
        FT: FnMut(&str) + Send,
        FC: FnMut(&str) + Send,
    {
        let emitted = std::sync::atomic::AtomicBool::new(false);
        let primary = {
            let mut relay_thought = |thought: &str| {
                emitted.store(true, std::sync::atomic::Ordering::Relaxed);
                on_thought(thought);
            };
            let mut relay_chunk = |chunk: &str| {
                emitted.store(true, std::sync::atomic::Ordering::Relaxed);
                on_chunk(chunk);
            };
            if config.provider == "ollama" {
                self.stream_ollama_native(
                    config,
                    messages,
                    tools,
                    &mut relay_thought,
                    &mut relay_chunk,
                )
                .await
            } else {
                self.stream_remote(
                    config,
                    messages,
                    tools,
                    &mut relay_thought,
                    &mut relay_chunk,
                )
                .await
            }
        };
        let error = match primary {
            Ok(result) => return Ok(result),
            Err(error) => error,
        };
        if emitted.load(std::sync::atomic::Ordering::Relaxed)
            || !config.resilience.fallback_enabled
            || !is_transient_error(&error)
        {
            return Err(error);
        }

        let fallback_available = if config.provider == "ollama" {
            config.remote.enabled
        } else {
            config.ollama.enabled
        };
        if !fallback_available {
            return Err(error);
        }

        log::warn!(
            "Primary '{}' provider failed before streaming; trying configured fallback: {}",
            config.provider,
            error
        );
        let fallback = if config.provider == "ollama" {
            self.stream_remote(config, messages, tools, on_thought, on_chunk)
                .await
        } else {
            self.stream_ollama_native(config, messages, tools, on_thought, on_chunk)
                .await
        };
        fallback.map_err(|fallback_error| {
            AppError::Agent(format!(
                "Primary provider failed: {}; fallback provider also failed: {}",
                error, fallback_error
            ))
        })
    }

    async fn stream_remote<FT, FC>(
        &self,
        config: &AiConfig,
        messages: &[AgentMessage],
        tools: &[ToolDefinition],
        mut on_thought: FT,
        mut on_chunk: FC,
    ) -> Result<LlmChatResult, AppError>
    where
        FT: FnMut(&str) + Send,
        FC: FnMut(&str) + Send,
    {
        let mut effective = config.clone();
        let subscription_token = if config.remote.auth_mode == "chatgpt" {
            if !config.remote.enabled {
                return Err(AppError::Agent("Remote AI provider is disabled".into()));
            }
            let access = crate::agent::chatgpt::access(&config.remote.chatgpt_profile_id)
                .await
                .map_err(AppError::Agent)?;
            effective.remote.base_url = crate::agent::chatgpt::API_BASE.into();
            effective.remote.api_format = "responses".into();
            effective.remote.chat_model = config.remote.chatgpt_model.clone();
            effective.remote.chatgpt_profile_id = access.profile_id;
            effective.remote.api_key.clear();
            Some(access.token)
        } else {
            None
        };
        let config = &effective;
        let base_url = &config.remote.base_url;
        let api_key = subscription_token
            .as_deref()
            .unwrap_or(&config.remote.api_key);
        let timeout_seconds = config.remote.timeout_seconds;
        let enabled = config.remote.enabled;

        if !enabled {
            return Err(AppError::Agent(format!(
                "The configured '{}' AI provider is disabled",
                config.provider
            )));
        }
        if config.remote.chat_model.trim().is_empty() {
            return Err(AppError::Agent("No chat model is configured".to_string()));
        }

        let use_responses = config.remote.api_format == "responses";
        let url = remote_endpoint(base_url, use_responses);
        if !use_responses
            && !tools.is_empty()
            && config
                .remote
                .chat_model
                .trim()
                .to_ascii_lowercase()
                .starts_with("gpt-6.1-sol")
        {
            return Err(AppError::Agent(
                "GPT-6.1 Sol tool calling requires Responses API".to_string(),
            ));
        }
        let (model, payload) = if use_responses {
            build_responses_payload(config, messages, tools)?
        } else {
            build_remote_payload(config, messages, tools)
        };

        use std::hash::{Hash, Hasher};
        let proxy = config.network.for_auth(&config.remote.auth_mode);
        let mut fingerprint = std::collections::hash_map::DefaultHasher::new();
        proxy.hash(&mut fingerprint);
        let circuit_key = format!("remote:{}:{:x}", url, fingerprint.finish());
        let mut resp = self
            .send_json_with_resilience(
                config,
                &circuit_key,
                &url,
                &payload,
                (!api_key.is_empty()).then(|| format!("Bearer {}", api_key)),
                timeout_seconds,
            )
            .await?;

        if !resp.status().is_success() {
            let status = resp.status();
            let err_text = resp.text().await.unwrap_or_default();
            if config.remote.auth_mode == "chatgpt" {
                if let Ok(value) = serde_json::from_str::<serde_json::Value>(&err_text) {
                    if let Some(message) = crate::agent::chatgpt::inference_error(&value["error"]) {
                        return Err(AppError::Agent(message));
                    }
                }
            }
            return Err(provider_status_error("Remote LLM", status, &err_text));
        }

        if use_responses {
            let mut result = read_responses_stream(resp, model, url, on_thought, on_chunk).await?;
            if config.remote.auth_mode == "chatgpt" {
                if let Some(replay) = &mut result.message.response_replay {
                    replay.auth_scope =
                        Some(format!("chatgpt:{}", config.remote.chatgpt_profile_id));
                }
            }
            return Ok(result);
        }

        let mut accumulated_content = String::new();
        let mut accumulated_tool_calls: Vec<ToolCall> = Vec::new();
        let mut buffer = String::new();
        let mut parse_error: Option<String> = None;
        let mut finish_reason: Option<String> = None;
        let mut usage = LlmUsage::default();
        let mut accumulated_reasoning = String::new();

        let mut parse_data = |data: &str| {
            if data == "[DONE]" {
                return;
            }
            match serde_json::from_str::<serde_json::Value>(data) {
                Ok(json_val) => {
                    if let Some(error) = json_val.get("error") {
                        parse_error = Some(format!("LLM stream returned an error: {}", error));
                        return;
                    }
                    if let Some(choices) = json_val["choices"].as_array() {
                        if let Some(choice) = choices.first() {
                            if let Some(reason) = choice["finish_reason"].as_str() {
                                finish_reason = Some(reason.to_string());
                            }
                            let delta = &choice["delta"];
                            if let Some(reasoning) = delta["reasoning_content"].as_str() {
                                if !reasoning.is_empty() {
                                    on_thought(reasoning);
                                    accumulated_reasoning.push_str(reasoning);
                                    usage.reasoning_chars = usage
                                        .reasoning_chars
                                        .saturating_add(reasoning.chars().count() as u64);
                                }
                            }
                            if let Some(content) = delta["content"].as_str() {
                                if !content.is_empty() {
                                    on_chunk(content);
                                    accumulated_content.push_str(content);
                                }
                            }
                            if let Some(tcs) = delta["tool_calls"].as_array() {
                                for tc in tcs {
                                    let idx = tc["index"].as_u64().unwrap_or(0) as usize;
                                    while accumulated_tool_calls.len() <= idx {
                                        accumulated_tool_calls.push(ToolCall {
                                            id: String::new(),
                                            call_type: "function".to_string(),
                                            function: FunctionCall {
                                                name: String::new(),
                                                arguments: String::new(),
                                            },
                                        });
                                    }
                                    if let Some(id) = tc["id"].as_str() {
                                        if !id.is_empty() {
                                            accumulated_tool_calls[idx].id = id.to_string();
                                        }
                                    }
                                    if let Some(name) = tc["function"]["name"].as_str() {
                                        if !name.is_empty() {
                                            accumulated_tool_calls[idx]
                                                .function
                                                .name
                                                .push_str(name);
                                        }
                                    }
                                    if let Some(args) = tc["function"]["arguments"].as_str() {
                                        if !args.is_empty() {
                                            accumulated_tool_calls[idx]
                                                .function
                                                .arguments
                                                .push_str(args);
                                        }
                                    }
                                }
                            }
                        }
                    }
                    if let Some(stream_usage) = json_val.get("usage") {
                        usage.prompt_tokens = stream_usage["prompt_tokens"].as_u64().unwrap_or(0);
                        usage.completion_tokens =
                            stream_usage["completion_tokens"].as_u64().unwrap_or(0);
                    }
                }
                Err(error) => {
                    parse_error = Some(format!("Invalid JSON in LLM stream: {}", error));
                }
            }
        };

        let mut stream_bytes = 0usize;
        while let Some(chunk) = resp
            .chunk()
            .await
            .map_err(|e| transient_error(format!("Error reading remote stream chunk: {}", e)))?
        {
            stream_bytes = stream_bytes.saturating_add(chunk.len());
            if stream_bytes > 20 * 1024 * 1024 {
                return Err(AppError::Agent(
                    "Remote LLM stream exceeded the 20 MiB safety limit".to_string(),
                ));
            }
            let chunk_str = String::from_utf8_lossy(&chunk);
            buffer.push_str(&chunk_str);

            while let Some(pos) = buffer.find('\n') {
                let line = buffer[..pos].trim().to_string();
                buffer.drain(..=pos);

                if line.is_empty() {
                    continue;
                }
                if let Some(data) = line.strip_prefix("data:") {
                    parse_data(data.trim());
                }
            }
        }

        let rem = buffer.trim();
        if let Some(data) = rem.strip_prefix("data:") {
            parse_data(data.trim());
        }

        if let Some(error) = parse_error {
            return Err(AppError::Agent(error));
        }
        if finish_reason.as_deref() == Some("length") {
            return Err(AppError::Agent(
                "LLM response was truncated because the output limit was reached".to_string(),
            ));
        }

        if !accumulated_tool_calls.is_empty() {
            for (i, tc) in accumulated_tool_calls.iter_mut().enumerate() {
                if tc.id.is_empty() {
                    tc.id = format!("call_{}_{}", uuid::Uuid::new_v4().simple(), i);
                }
            }
            let mut message =
                AgentMessage::assistant_with_tools(accumulated_content, accumulated_tool_calls);
            if !accumulated_reasoning.is_empty() {
                message.reasoning_content = Some(accumulated_reasoning);
            }
            Ok(LlmChatResult {
                message,
                usage,
                provider: "remote".to_string(),
                model,
            })
        } else {
            if accumulated_content.is_empty() && accumulated_reasoning.is_empty() {
                return Err(AppError::Agent(
                    "LLM stream ended without content or tool calls".to_string(),
                ));
            }
            let mut message = AgentMessage::assistant(accumulated_content);
            if !accumulated_reasoning.is_empty() {
                message.reasoning_content = Some(accumulated_reasoning);
            }
            Ok(LlmChatResult {
                message,
                usage,
                provider: "remote".to_string(),
                model,
            })
        }
    }

    async fn stream_ollama_native<FT, FC>(
        &self,
        config: &AiConfig,
        messages: &[AgentMessage],
        tools: &[ToolDefinition],
        mut on_thought: FT,
        mut on_chunk: FC,
    ) -> Result<LlmChatResult, AppError>
    where
        FT: FnMut(&str) + Send,
        FC: FnMut(&str) + Send,
    {
        if !config.ollama.enabled {
            return Err(AppError::Agent(
                "The configured Ollama provider is disabled".to_string(),
            ));
        }
        let base = config.ollama.base_url.trim_end_matches('/');
        let url = if base.ends_with("/api/chat") {
            base.to_string()
        } else {
            format!("{}/api/chat", base)
        };
        let circuit_key = format!("ollama:{}", url);

        let mut response = None;
        for attempt in 0..2 {
            let include_tools = attempt == 0 && !tools.is_empty();
            let mut payload = json!({
                "model": config.ollama.chat_model,
                "messages": ollama_messages(messages),
                "stream": true,
                "options": {
                    "temperature": config.ollama.temperature,
                    "top_p": config.ollama.top_p,
                    "num_ctx": config.ollama.context_window_tokens,
                    "num_predict": config.ollama.max_output_tokens,
                }
            });
            if include_tools {
                payload["tools"] = json!(tools);
            }
            let candidate = self
                .send_json_with_resilience(
                    config,
                    &circuit_key,
                    &url,
                    &payload,
                    None,
                    config.ollama.timeout_seconds,
                )
                .await?;
            if candidate.status().is_success() {
                response = Some(candidate);
                break;
            }
            let status = candidate.status();
            let body = candidate.text().await.unwrap_or_default();
            let tool_unsupported = include_tools
                && status.as_u16() == 400
                && ["tool", "function"]
                    .iter()
                    .any(|marker| body.to_lowercase().contains(marker));
            if !tool_unsupported {
                return Err(provider_status_error("Ollama", status, &body));
            }
            log::warn!(
                "Ollama model '{}' rejected tools; retrying in chat-only mode",
                config.ollama.chat_model
            );
        }
        let mut response = response.ok_or_else(|| {
            AppError::Agent("Ollama did not return a usable response".to_string())
        })?;

        let mut buffer = String::new();
        let mut content = String::new();
        let mut tool_calls = Vec::new();
        let mut stream_error = None;
        let mut usage = LlmUsage::default();
        let mut accumulated_thinking = String::new();
        let mut parse_line = |line: &str| {
            if line.trim().is_empty() {
                return;
            }
            let value = match serde_json::from_str::<serde_json::Value>(line) {
                Ok(value) => value,
                Err(error) => {
                    stream_error = Some(format!("Invalid Ollama stream JSON: {}", error));
                    return;
                }
            };
            if let Some(error) = value["error"].as_str() {
                stream_error = Some(format!("Ollama stream error: {}", error));
                return;
            }
            let message = &value["message"];
            if let Some(thinking) = message["thinking"].as_str() {
                if !thinking.is_empty() {
                    on_thought(thinking);
                    accumulated_thinking.push_str(thinking);
                    usage.reasoning_chars = usage
                        .reasoning_chars
                        .saturating_add(thinking.chars().count() as u64);
                }
            }
            usage.prompt_tokens = value["prompt_eval_count"]
                .as_u64()
                .unwrap_or(usage.prompt_tokens);
            usage.completion_tokens = value["eval_count"]
                .as_u64()
                .unwrap_or(usage.completion_tokens);
            if let Some(delta) = message["content"].as_str() {
                if !delta.is_empty() {
                    on_chunk(delta);
                    content.push_str(delta);
                }
            }
            if let Some(calls) = message["tool_calls"].as_array() {
                for call in calls {
                    let name = call["function"]["name"]
                        .as_str()
                        .unwrap_or_default()
                        .to_string();
                    if name.is_empty() {
                        continue;
                    }
                    let arguments = match &call["function"]["arguments"] {
                        serde_json::Value::String(value) => value.clone(),
                        value => serde_json::to_string(value).unwrap_or_else(|_| "{}".to_string()),
                    };
                    tool_calls.push(ToolCall {
                        id: format!("call_{}", uuid::Uuid::new_v4().simple()),
                        call_type: "function".to_string(),
                        function: FunctionCall { name, arguments },
                    });
                }
            }
        };

        let mut stream_bytes = 0usize;
        while let Some(chunk) = response
            .chunk()
            .await
            .map_err(|error| transient_error(format!("Error reading Ollama stream: {}", error)))?
        {
            stream_bytes = stream_bytes.saturating_add(chunk.len());
            if stream_bytes > 20 * 1024 * 1024 {
                return Err(AppError::Agent(
                    "Ollama stream exceeded the 20 MiB safety limit".to_string(),
                ));
            }
            buffer.push_str(&String::from_utf8_lossy(&chunk));
            while let Some(position) = buffer.find('\n') {
                let line = buffer[..position].trim().to_string();
                buffer.drain(..=position);
                parse_line(&line);
            }
        }
        if !buffer.trim().is_empty() {
            parse_line(buffer.trim());
        }
        if let Some(error) = stream_error {
            return Err(AppError::Agent(error));
        }
        if !tool_calls.is_empty() {
            let mut message = AgentMessage::assistant_with_tools(content, tool_calls);
            if !accumulated_thinking.is_empty() {
                message.reasoning_content = Some(accumulated_thinking);
            }
            Ok(LlmChatResult {
                message,
                usage,
                provider: "ollama".to_string(),
                model: config.ollama.chat_model.clone(),
            })
        } else if content.is_empty() && accumulated_thinking.is_empty() {
            Err(AppError::Agent(
                "Ollama stream ended without content or tool calls".to_string(),
            ))
        } else {
            let mut message = AgentMessage::assistant(content);
            if !accumulated_thinking.is_empty() {
                message.reasoning_content = Some(accumulated_thinking);
            }
            Ok(LlmChatResult {
                message,
                usage,
                provider: "ollama".to_string(),
                model: config.ollama.chat_model.clone(),
            })
        }
    }

    pub async fn reset_network(&self) {
        *self.remote_http.lock().await = None;
        self.circuits
            .lock()
            .await
            .retain(|key, _| !key.starts_with("remote:"));
    }

    async fn remote_client(&self, config: &AiConfig, target: &str) -> Result<Client, AppError> {
        let proxy = config.network.for_auth(&config.remote.auth_mode);
        let loopback = crate::agent::network::is_loopback(target);
        let mut cache = self.remote_http.lock().await;
        if let Some((saved, saved_loopback, client)) = &*cache {
            if saved == proxy && *saved_loopback == loopback {
                return Ok(client.clone());
            }
        }
        let client = crate::agent::network::client_builder(proxy, target)?
            .timeout(Duration::from_secs(300))
            .build()
            .map_err(|_| AppError::Agent("Unable to initialize AI proxy client".into()))?;
        *cache = Some((proxy.clone(), loopback, client.clone()));
        Ok(client)
    }

    async fn send_json_with_resilience(
        &self,
        config: &AiConfig,
        provider_key: &str,
        url: &str,
        payload: &serde_json::Value,
        authorization: Option<String>,
        timeout_seconds: u64,
    ) -> Result<reqwest::Response, AppError> {
        self.ensure_circuit_closed(provider_key).await?;
        let client = if provider_key.starts_with("remote:") {
            self.remote_client(config, url).await?
        } else if crate::agent::network::is_loopback(url) {
            self.direct_http.clone()
        } else {
            self.http.clone()
        };
        let max_retries = config.resilience.max_retries.min(8);
        for attempt in 0..=max_retries {
            let mut request = client
                .post(url)
                .timeout(Duration::from_secs(timeout_seconds.max(1)))
                .json(payload);
            if let Some(value) = &authorization {
                request = request.header("Authorization", value);
            }
            match request.send().await {
                Ok(response) => {
                    if !is_retryable_status(response.status())
                        || (config.remote.auth_mode == "chatgpt"
                            && response.status() == reqwest::StatusCode::TOO_MANY_REQUESTS)
                    {
                        self.record_provider_success(provider_key).await;
                        return Ok(response);
                    }
                    if attempt == max_retries {
                        self.record_provider_failure(provider_key, config).await;
                        return Ok(response);
                    }
                    let retry_after = response
                        .headers()
                        .get(reqwest::header::RETRY_AFTER)
                        .and_then(|value| value.to_str().ok())
                        .and_then(|value| value.parse::<u64>().ok())
                        .map(Duration::from_secs);
                    tokio::time::sleep(retry_after.unwrap_or_else(|| {
                        retry_delay(config.resilience.retry_base_delay_ms, attempt)
                    }))
                    .await;
                }
                Err(error) => {
                    if attempt == max_retries {
                        self.record_provider_failure(provider_key, config).await;
                        return Err(transient_error(format!(
                            "{} request failed ({}): {}",
                            provider_key, url, error
                        )));
                    }
                    tokio::time::sleep(retry_delay(config.resilience.retry_base_delay_ms, attempt))
                        .await;
                }
            }
        }
        Err(transient_error("Provider retry loop ended unexpectedly"))
    }

    async fn ensure_circuit_closed(&self, provider_key: &str) -> Result<(), AppError> {
        let mut circuits = self.circuits.lock().await;
        if let Some(state) = circuits.get_mut(provider_key) {
            if let Some(until) = state.open_until {
                if until > Instant::now() {
                    return Err(transient_error(format!(
                        "{} circuit breaker is open for another {} seconds",
                        provider_key,
                        until.saturating_duration_since(Instant::now()).as_secs() + 1
                    )));
                }
                state.open_until = None;
                state.consecutive_failures = 0;
            }
        }
        Ok(())
    }

    async fn record_provider_success(&self, provider_key: &str) {
        self.circuits.lock().await.remove(provider_key);
    }

    async fn record_provider_failure(&self, provider_key: &str, config: &AiConfig) {
        let mut circuits = self.circuits.lock().await;
        let state = circuits
            .entry(provider_key.to_string())
            .or_insert(CircuitState {
                consecutive_failures: 0,
                open_until: None,
            });
        state.consecutive_failures = state.consecutive_failures.saturating_add(1);
        if state.consecutive_failures >= config.resilience.circuit_breaker_threshold {
            state.open_until = Some(
                Instant::now()
                    + Duration::from_secs(config.resilience.circuit_breaker_cooldown_seconds),
            );
        }
    }
}

/// Build the OpenAI/DeepSeek-compatible request body, adapting thinking mode,
/// reasoning effort, and sampling parameters for models like DeepSeek 4.1 Flash.
fn build_remote_payload(
    config: &AiConfig,
    messages: &[AgentMessage],
    tools: &[ToolDefinition],
) -> (String, serde_json::Value) {
    let remote = &config.remote;
    let thinking_mode = remote.thinking_mode.as_str();
    let chat_lower = remote.chat_model.trim().to_ascii_lowercase();
    // If thinking is explicitly enabled and a dedicated reasoning_model is configured
    // (for non-Flash models), switch to reasoning_model; Flash models support native thinking toggle.
    let mut model = if thinking_mode == "enabled"
        && !remote.reasoning_model.trim().is_empty()
        && !chat_lower.contains("flash")
        && !chat_lower.contains("reasoner")
        && !chat_lower.starts_with("gpt-6")
    {
        remote.reasoning_model.trim().to_string()
    } else {
        remote.chat_model.trim().to_string()
    };

    // Correct the previously suggested model identifier on the official endpoint.
    // Keep custom gateway identifiers intact.
    let is_official_deepseek = url::Url::parse(&remote.base_url)
        .ok()
        .and_then(|url| url.host_str().map(str::to_owned))
        .is_some_and(|host| host == "api.deepseek.com");
    if is_official_deepseek && model.eq_ignore_ascii_case("deepseek-4.1-flash") {
        model = "deepseek-flash".to_string();
    }

    let model_lower = model.to_ascii_lowercase();
    let base_lower = remote.base_url.to_ascii_lowercase();
    let is_deepseek = base_lower.contains("deepseek") || model_lower.contains("deepseek");
    let is_flash = model_lower.contains("flash");
    let is_openai_reasoner = model_lower.starts_with("o1")
        || model_lower.starts_with("o3")
        || model_lower.starts_with("o4")
        || model_lower.contains("gpt-5")
        || model_lower.starts_with("gpt-6");
    let is_intrinsic_reasoner =
        model_lower.contains("reasoner") || model_lower.contains("r1") || is_openai_reasoner;

    let is_thinking_active = match thinking_mode {
        "enabled" => true,
        "disabled" => false,
        _ => is_intrinsic_reasoner || (is_deepseek && is_flash),
    };

    let wire_messages = if is_deepseek {
        deepseek_messages(messages)
    } else {
        provider_messages(messages)
    };

    let mut payload = json!({
        "model": model,
        "messages": wire_messages,
        "stream": true,
        "max_tokens": remote.max_output_tokens,
        "stream_options": { "include_usage": true },
    });

    let round_f32 = |v: f32| ((v as f64) * 1000.0).round() / 1000.0;

    if is_thinking_active {
        // In thinking mode, temperature is unsupported/ignored by DeepSeek & OpenAI reasoning engines.
        if is_deepseek {
            let effective_top_p = if is_flash {
                remote.top_p.clamp(0.95, 1.0)
            } else {
                remote.top_p
            };
            payload["top_p"] = json!(round_f32(effective_top_p));
        }
    } else {
        payload["temperature"] = json!(round_f32(remote.temperature));
        if !(is_deepseek && is_flash) {
            payload["top_p"] = json!(round_f32(remote.top_p));
        }
    }

    if is_deepseek {
        if thinking_mode == "enabled" {
            payload["thinking"] = json!({ "type": "enabled" });
        } else if thinking_mode == "disabled" {
            payload["thinking"] = json!({ "type": "disabled" });
        }
        if is_thinking_active && (is_flash || thinking_mode == "enabled") {
            let effort = if is_flash && remote.reasoning_effort == "medium" {
                "high"
            } else {
                remote.reasoning_effort.as_str()
            };
            payload["reasoning_effort"] = json!(effort);
        }
    } else if is_thinking_active && is_openai_reasoner {
        let effort = if remote.reasoning_effort == "max" && !model_lower.starts_with("gpt-6") {
            "high"
        } else {
            remote.reasoning_effort.as_str()
        };
        payload["reasoning_effort"] = json!(effort);
    }

    if !tools.is_empty() {
        payload["tools"] = json!(tools);
    }

    (model, payload)
}

fn is_retryable_status(status: reqwest::StatusCode) -> bool {
    status == reqwest::StatusCode::REQUEST_TIMEOUT
        || status == reqwest::StatusCode::TOO_MANY_REQUESTS
        || status.is_server_error()
}

fn retry_delay(base_ms: u64, attempt: u32) -> Duration {
    let exponential = base_ms.saturating_mul(1_u64 << attempt.min(10));
    let jitter = ((attempt as u64 + 1) * 97) % base_ms.max(1);
    Duration::from_millis(exponential.saturating_add(jitter).min(60_000))
}

pub(super) fn transient_error(message: impl Into<String>) -> AppError {
    AppError::Agent(format!("Transient provider error: {}", message.into()))
}

fn is_transient_error(error: &AppError) -> bool {
    error.to_string().contains("Transient provider error:")
}

fn provider_status_error(provider: &str, status: reqwest::StatusCode, body: &str) -> AppError {
    let message = format!("{} API error (status {}): {}", provider, status, body);
    if is_retryable_status(status) {
        transient_error(message)
    } else {
        AppError::Agent(message)
    }
}

/// Convert stored/UI messages to the strict OpenAI-compatible wire schema.
fn provider_messages(messages: &[AgentMessage]) -> Vec<serde_json::Value> {
    messages
        .iter()
        .map(|message| {
            let mut value = json!({
                "role": message.role,
                "content": message.content,
            });
            if let Some(tool_calls) = &message.tool_calls {
                value["tool_calls"] = json!(tool_calls);
            }
            if let Some(tool_call_id) = &message.tool_call_id {
                value["tool_call_id"] = json!(tool_call_id);
            }
            if message.role == "tool" {
                if let Some(name) = &message.name {
                    value["name"] = json!(name);
                }
            }
            value
        })
        .collect()
}

fn ollama_messages(messages: &[AgentMessage]) -> Vec<serde_json::Value> {
    provider_messages(messages)
        .into_iter()
        .zip(messages)
        .map(|(mut value, stored)| {
            if stored.role == "assistant" && stored.tool_calls.is_some() {
                if let Some(reasoning) = &stored.reasoning_content {
                    value["thinking"] = json!(reasoning);
                }
            }
            if let Some(calls) = value
                .get_mut("tool_calls")
                .and_then(|value| value.as_array_mut())
            {
                for call in calls {
                    if let Some(arguments) = call["function"]["arguments"].as_str() {
                        if let Ok(parsed) = serde_json::from_str::<serde_json::Value>(arguments) {
                            call["function"]["arguments"] = parsed;
                        }
                    }
                }
            }
            value
        })
        .collect()
}

fn deepseek_messages(messages: &[AgentMessage]) -> Vec<serde_json::Value> {
    let mut values = provider_messages(messages);
    for (value, message) in values.iter_mut().zip(messages) {
        if message.role == "assistant" && message.tool_calls.is_some() {
            if let Some(reasoning) = &message.reasoning_content {
                value["reasoning_content"] = json!(reasoning);
            }
        }
    }
    values
}

#[cfg(test)]
mod tests {
    use super::{
        build_remote_payload, deepseek_messages, is_retryable_status, ollama_messages,
        provider_messages, retry_delay, LlmClient,
    };
    use crate::agent::config::AiConfig;
    use crate::agent::types::AgentMessage;

    #[test]
    fn provider_messages_omit_internal_metadata() {
        let values = provider_messages(&[AgentMessage::user("hello")]);
        assert_eq!(values[0]["role"], "user");
        assert_eq!(values[0]["content"], "hello");
        assert!(values[0].get("id").is_none());
        assert!(values[0].get("timestamp").is_none());
    }

    #[test]
    fn ollama_messages_use_object_tool_arguments() {
        let mut message = AgentMessage::assistant_with_tools(
            "",
            vec![crate::agent::types::ToolCall {
                id: "call-1".to_string(),
                call_type: "function".to_string(),
                function: crate::agent::types::FunctionCall {
                    name: "test".to_string(),
                    arguments: "{\"value\":1}".to_string(),
                },
            }],
        );
        message.reasoning_content = Some("reasoning required for tool continuation".to_string());
        let values = ollama_messages(&[message]);
        assert_eq!(
            values[0]["tool_calls"][0]["function"]["arguments"]["value"],
            1
        );
        assert_eq!(
            values[0]["thinking"],
            "reasoning required for tool continuation"
        );
    }

    #[test]
    fn deepseek_tool_turn_preserves_reasoning_content() {
        let mut message = AgentMessage::assistant_with_tools(
            "",
            vec![crate::agent::types::ToolCall {
                id: "call-1".to_string(),
                call_type: "function".to_string(),
                function: crate::agent::types::FunctionCall {
                    name: "test".to_string(),
                    arguments: "{}".to_string(),
                },
            }],
        );
        message.reasoning_content = Some("required context".to_string());
        let values = deepseek_messages(&[message]);
        assert_eq!(values[0]["reasoning_content"], "required context");
    }

    #[test]
    fn deepseek_flash_payload_adapts_thinking_and_sampling() {
        let mut config = AiConfig::default();
        config.remote.base_url = "https://api.deepseek.com".to_string();
        config.remote.chat_model = "deepseek-4.1-flash".to_string();
        config.remote.top_p = 0.8;
        config.remote.thinking_mode = "enabled".to_string();
        config.remote.reasoning_effort = "high".to_string();

        let (model, payload) = build_remote_payload(&config, &[AgentMessage::user("hi")], &[]);
        assert_eq!(model, "deepseek-flash");
        assert!(payload.get("temperature").is_none());
        assert_eq!(payload["top_p"].as_f64().unwrap(), 0.95);
        assert_eq!(payload["thinking"]["type"], "enabled");
        assert_eq!(payload["reasoning_effort"], "high");

        config.remote.thinking_mode = "disabled".to_string();
        let (_, disabled_payload) = build_remote_payload(&config, &[AgentMessage::user("hi")], &[]);
        assert!(disabled_payload.get("temperature").is_some());
        assert_eq!(disabled_payload["thinking"]["type"], "disabled");
        assert!(disabled_payload.get("reasoning_effort").is_none());
        assert!(disabled_payload.get("top_p").is_none());
    }

    #[test]
    fn flash_auto_uses_native_thinking_and_maps_legacy_effort() {
        let mut config = AiConfig::default();
        config.remote.reasoning_effort = "medium".to_string();
        config.remote.reasoning_model = "deepseek-reasoner".to_string();
        let (model, payload) = build_remote_payload(&config, &[AgentMessage::user("hi")], &[]);
        assert_eq!(model, "deepseek-flash");
        assert_eq!(payload["reasoning_effort"], "high");
        assert!(payload.get("thinking").is_none());
        assert!(payload.get("temperature").is_none());
        config.remote.thinking_mode = "enabled".to_string();
        let (model, _) = build_remote_payload(&config, &[], &[]);
        assert_eq!(model, "deepseek-flash");
        config.remote.base_url = "https://gateway.example/v1".to_string();
        config.remote.chat_model = "deepseek-4.1-flash".to_string();
        let (model, _) = build_remote_payload(&config, &[], &[]);
        assert_eq!(model, "deepseek-4.1-flash");
    }

    #[test]
    fn classifies_retryable_status_and_caps_backoff() {
        assert!(is_retryable_status(reqwest::StatusCode::TOO_MANY_REQUESTS));
        assert!(is_retryable_status(reqwest::StatusCode::BAD_GATEWAY));
        assert!(!is_retryable_status(reqwest::StatusCode::UNAUTHORIZED));
        assert!(retry_delay(100, 2) > retry_delay(100, 1));
        assert!(retry_delay(60_000, 10).as_secs() <= 60);
    }

    #[tokio::test]
    async fn retries_transient_remote_failure_before_streaming() {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        let server = tokio::spawn(serve_http_responses(
            listener,
            vec![
                ("500 Internal Server Error", "temporary".to_string()),
                (
                    "200 OK",
                    "data: {\"choices\":[{\"delta\":{\"content\":\"ok\"},\"finish_reason\":\"stop\"}],\"usage\":{\"prompt_tokens\":1,\"completion_tokens\":1}}\n\ndata: [DONE]\n\n".to_string(),
                ),
            ],
        ));
        let mut config = AiConfig::default();
        config.remote.api_format = "chat_completions".to_string();
        config.remote.base_url = format!("http://{}/v1", address);
        config.remote.api_key.clear();
        config.ollama.enabled = false;
        config.resilience.fallback_enabled = false;
        config.resilience.max_retries = 1;
        config.resilience.retry_base_delay_ms = 50;
        let mut streamed = String::new();
        let result = LlmClient::new()
            .stream_chat(&config, &[AgentMessage::user("hello")], &[], |chunk| {
                streamed.push_str(chunk)
            })
            .await
            .unwrap();
        assert_eq!(streamed, "ok");
        assert_eq!(result.message.content, "ok");
        server.await.unwrap();
    }

    #[tokio::test]
    async fn opens_circuit_after_configured_failure_threshold() {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        let server = tokio::spawn(serve_http_responses(
            listener,
            vec![("503 Service Unavailable", "down".to_string())],
        ));
        let mut config = AiConfig::default();
        config.remote.api_format = "chat_completions".to_string();
        config.remote.base_url = format!("http://{}/v1", address);
        config.remote.api_key.clear();
        config.ollama.enabled = false;
        config.resilience.fallback_enabled = false;
        config.resilience.max_retries = 0;
        config.resilience.circuit_breaker_threshold = 1;
        let client = LlmClient::new();
        let _ = client
            .stream_chat(&config, &[AgentMessage::user("hello")], &[], |_| {})
            .await
            .err()
            .expect("first request should fail");
        let second = client
            .stream_chat(&config, &[AgentMessage::user("hello")], &[], |_| {})
            .await
            .err()
            .expect("circuit should reject second request");
        assert!(second.to_string().contains("circuit breaker is open"));
        server.await.unwrap();
    }

    async fn serve_http_responses(
        listener: tokio::net::TcpListener,
        responses: Vec<(&'static str, String)>,
    ) {
        use tokio::io::{AsyncReadExt, AsyncWriteExt};
        for (status, body) in responses {
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
            let content_type = if body.starts_with("data:") {
                "text/event-stream"
            } else {
                "text/plain"
            };
            let response = format!(
                "HTTP/1.1 {}\r\nContent-Type: {}\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
                status,
                content_type,
                body.len(),
                body
            );
            socket.write_all(response.as_bytes()).await.unwrap();
        }
    }
}
