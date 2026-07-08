//! LabNexus — Unified LLM Provider client.
//!
//! Handles OpenAI-compatible APIs (DeepSeek, OpenAI) and Local Ollama / llama.cpp HTTP APIs
//! with real-time SSE streaming for text and tool calls.

use crate::agent::config::AiConfig;
use crate::agent::types::*;
use crate::error::AppError;
use reqwest::Client;
use serde_json::json;
use std::time::Duration;

/// Unified client for interacting with AI models over HTTP.
#[derive(Clone)]
pub struct LlmClient {
    http: Client,
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
        mut on_chunk: F,
    ) -> Result<AgentMessage, AppError>
    where
        F: FnMut(&str) + Send,
    {
        let (base_url, model, api_key, temp, top_p) = if config.provider == "ollama" {
            (
                &config.ollama.base_url,
                &config.ollama.chat_model,
                "",
                config.ollama.temperature,
                config.ollama.top_p,
            )
        } else {
            (
                &config.remote.base_url,
                &config.remote.chat_model,
                config.remote.api_key.as_str(),
                config.remote.temperature,
                config.remote.top_p,
            )
        };

        let mut url = base_url.trim_end_matches('/').to_string();
        if url.ends_with("/chat/completions") {
            // already full endpoint path
        } else if url.ends_with("/v1") {
            url.push_str("/chat/completions");
        } else {
            url.push_str("/v1/chat/completions");
        }

        let mut payload = json!({
            "model": model,
            "messages": messages,
            "temperature": temp,
            "top_p": top_p,
            "stream": true,
        });

        if !tools.is_empty() {
            payload["tools"] = json!(tools);
        }

        let mut req = self.http.post(&url).json(&payload);
        if !api_key.is_empty() {
            req = req.header("Authorization", format!("Bearer {}", api_key));
        }

        let mut resp = req
            .send()
            .await
            .map_err(|e| AppError::Agent(format!("LLM HTTP request failed ({}): {}", url, e)))?;

        if !resp.status().is_success() {
            let status = resp.status();
            let err_text = resp.text().await.unwrap_or_default();
            return Err(AppError::Agent(format!(
                "LLM API error (status {}): {}",
                status, err_text
            )));
        }

        let mut accumulated_content = String::new();
        let mut accumulated_tool_calls: Vec<ToolCall> = Vec::new();
        let mut buffer = String::new();

        let mut parse_data = |data: &str| {
            if data == "[DONE]" {
                return;
            }
            if let Ok(json_val) = serde_json::from_str::<serde_json::Value>(data) {
                if let Some(choices) = json_val["choices"].as_array() {
                    if let Some(choice) = choices.first() {
                        let delta = &choice["delta"];
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
                                        accumulated_tool_calls[idx].function.name.push_str(name);
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
            }
        };

        while let Some(chunk) = resp
            .chunk()
            .await
            .map_err(|e| AppError::Agent(format!("Error reading stream chunk: {}", e)))?
        {
            let chunk_str = String::from_utf8_lossy(&chunk);
            buffer.push_str(&chunk_str);

            while let Some(pos) = buffer.find('\n') {
                let line = buffer[..pos].trim().to_string();
                buffer.drain(..=pos);

                if line.is_empty() {
                    continue;
                }
                if let Some(data) = line.strip_prefix("data: ") {
                    parse_data(data.trim());
                }
            }
        }

        let rem = buffer.trim();
        if let Some(data) = rem.strip_prefix("data: ") {
            parse_data(data.trim());
        }

        if !accumulated_tool_calls.is_empty() {
            for (i, tc) in accumulated_tool_calls.iter_mut().enumerate() {
                if tc.id.is_empty() {
                    tc.id = format!("call_{}_{}", uuid::Uuid::new_v4().simple(), i);
                }
            }
            Ok(AgentMessage::assistant_with_tools(
                accumulated_content,
                accumulated_tool_calls,
            ))
        } else {
            Ok(AgentMessage::assistant(accumulated_content))
        }
    }
}
