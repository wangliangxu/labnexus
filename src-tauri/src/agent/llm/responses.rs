//! Stateless Responses API adapter shared by OpenAI and DeepSeek.
use super::provider::{transient_error, LlmChatResult, LlmUsage};
use crate::agent::{
    AgentMessage, AiConfig, FunctionCall, ResponseReplay, ToolCall, ToolDefinition,
};
use crate::error::AppError;
use serde_json::{json, Value};
use std::collections::BTreeMap;

pub(super) fn remote_endpoint(base: &str, responses: bool) -> String {
    let mut base = base.trim().trim_end_matches('/').to_string();
    for suffix in ["/chat/completions", "/responses"] {
        if let Some(root) = base.strip_suffix(suffix) {
            base = root.to_string();
            break;
        }
    }
    if base == "https://api.openai.com" {
        base.push_str("/v1");
    }
    format!(
        "{}/{}",
        base,
        if responses {
            "responses"
        } else {
            "chat/completions"
        }
    )
}

pub(super) fn build_responses_payload(
    config: &AiConfig,
    messages: &[AgentMessage],
    tools: &[ToolDefinition],
) -> Result<(String, Value), AppError> {
    let remote = &config.remote;
    let mut model = remote.chat_model.trim().to_string();
    let host = url::Url::parse(&remote.base_url)
        .ok()
        .and_then(|url| url.host_str().map(str::to_owned));
    if host.as_deref() == Some("api.deepseek.com")
        && model.eq_ignore_ascii_case("deepseek-4.1-flash")
    {
        model = "deepseek-flash".to_string();
    }
    let lower = model.to_ascii_lowercase();
    let deepseek = lower.contains("deepseek") || host.as_deref() == Some("api.deepseek.com");
    let sol = lower.starts_with("gpt-6.1-sol");
    let openai_reasoner = lower.starts_with("gpt-5")
        || lower.starts_with("gpt-6")
        || lower.starts_with("o1")
        || lower.starts_with("o3")
        || lower.starts_with("o4");
    if sol && remote.thinking_mode == "disabled" {
        return Err(AppError::Agent(
            "GPT-6.1 Sol requires reasoning; select low effort instead".to_string(),
        ));
    }
    let thinking = match remote.thinking_mode.as_str() {
        "enabled" => true,
        "disabled" => false,
        _ => deepseek || openai_reasoner || lower.contains("reasoner"),
    };
    let endpoint = remote_endpoint(&remote.base_url, true);
    let scope =
        (remote.auth_mode == "chatgpt").then(|| format!("chatgpt:{}", remote.chatgpt_profile_id));
    let input = response_input(messages, &model, &endpoint, deepseek, scope.as_deref());
    let mut payload = json!({
        "model": model, "input": input, "stream": true, "store": false,
        "max_output_tokens": remote.max_output_tokens,
    });
    if thinking {
        let effort = match remote.reasoning_effort.as_str() {
            "medium" | "xhigh" if deepseek => "high",
            "max" if openai_reasoner && !lower.starts_with("gpt-6") => "high",
            effort => effort,
        };
        payload["reasoning"] = json!({"effort": effort});
        if deepseek {
            if lower.contains("flash") {
                payload["top_p"] =
                    json!(((remote.top_p.clamp(0.95, 1.0) as f64) * 1000.0).round() / 1000.0);
            }
        } else {
            payload["reasoning"]["summary"] = json!("auto");
        }
    } else {
        if deepseek || openai_reasoner {
            payload["reasoning"] = json!({"effort": "none"});
        }
        payload["temperature"] = json!(remote.temperature);
        if !deepseek {
            payload["top_p"] = json!(remote.top_p);
        }
    }
    if !deepseek {
        payload["include"] = json!(["reasoning.encrypted_content"]);
    }
    if !tools.is_empty() {
        payload["tools"] =
            json!(tools.iter().map(|tool| json!({
            "type": "function", "name": tool.function.name,
            "description": tool.function.description, "parameters": tool.function.parameters,
            "strict": false,
        })).collect::<Vec<_>>());
    }
    if remote.auth_mode == "chatgpt" {
        // Subscription inference is a distinct Responses route with narrower fields.
        for field in ["max_output_tokens", "temperature", "top_p"] {
            payload.as_object_mut().unwrap().remove(field);
        }
        if let Some(input) = payload["input"].as_array_mut() {
            for item in input {
                if item["role"] == "system" {
                    item["role"] = json!("developer");
                }
            }
        }
        if let Some(functions) = payload.get("tools").cloned() {
            payload["tools"] = json!([{"type":"namespace", "name":"labnexus",
                "description":"LabNexus notebook and scientific computing tools", "tools":functions}]);
        }
    }
    Ok((model, payload))
}

fn response_input(
    messages: &[AgentMessage],
    model: &str,
    endpoint: &str,
    deepseek: bool,
    auth_scope: Option<&str>,
) -> Vec<Value> {
    let mut input = Vec::new();
    for message in messages {
        if message.role == "tool" {
            input.push(
                json!({"type":"function_call_output", "call_id":message.tool_call_id,
                "output":message.content}),
            );
            continue;
        }
        if message.role == "assistant" {
            if let Some(replay) = &message.response_replay {
                if replay.model == model
                    && replay.endpoint == endpoint
                    && replay.auth_scope.as_deref() == auth_scope
                {
                    input.extend(replay.output.clone());
                    continue;
                }
            } else if deepseek && message.tool_calls.is_some() {
                if let Some(reasoning) = &message.reasoning_content {
                    input.push(json!({"type":"reasoning", "summary":[],
                        "content":[{"type":"reasoning_text", "text":reasoning}]}));
                }
            }
        }
        if !message.content.is_empty() || message.role != "assistant" {
            input.push(json!({"role": message.role, "content": message.content}));
        }
        if let Some(calls) = &message.tool_calls {
            for call in calls {
                let mut item = json!({"type":"function_call", "call_id":call.id,
                    "name":call.function.name, "arguments":call.function.arguments});
                if auth_scope.is_some() {
                    item["namespace"] = json!("labnexus");
                }
                input.push(item);
            }
        }
    }
    input
}

// Decode complete SSE lines as UTF-8 so a multibyte character split across HTTP chunks survives.
#[derive(Default)]
struct SseDecoder {
    pending: Vec<u8>,
    data: Vec<String>,
}
impl SseDecoder {
    fn push(&mut self, bytes: &[u8]) -> Result<Vec<String>, AppError> {
        self.pending.extend_from_slice(bytes);
        let mut events = Vec::new();
        while let Some(end) = self.pending.iter().position(|byte| *byte == b'\n') {
            let line: Vec<u8> = self.pending.drain(..=end).collect();
            let line = std::str::from_utf8(&line).map_err(|error| {
                AppError::Agent(format!("Invalid UTF-8 in Responses stream: {}", error))
            })?;
            let line = line.trim_end_matches(['\r', '\n']);
            if line.is_empty() {
                if !self.data.is_empty() {
                    events.push(self.data.join("\n"));
                    self.data.clear();
                }
            } else if let Some(data) = line.strip_prefix("data:") {
                self.data
                    .push(data.strip_prefix(' ').unwrap_or(data).to_string());
            }
        }
        Ok(events)
    }
    fn finish(&mut self) -> Result<Vec<String>, AppError> {
        self.push(b"\n\n")
    }
}

#[derive(Default)]
struct ResponseStream {
    output: BTreeMap<u64, Value>,
    text: String,
    thoughts: String,
    usage: LlmUsage,
    completed: bool,
}
impl ResponseStream {
    fn event<FT: FnMut(&str), FC: FnMut(&str)>(
        &mut self,
        data: &str,
        thought: &mut FT,
        text: &mut FC,
    ) -> Result<(), AppError> {
        if data == "[DONE]" {
            return Ok(());
        }
        let event: Value = serde_json::from_str(data).map_err(|error| {
            AppError::Agent(format!("Invalid JSON in Responses stream: {}", error))
        })?;
        let kind = event["type"].as_str().unwrap_or("");
        match kind {
            "response.output_text.delta" | "response.refusal.delta" => {
                if let Some(delta) = event["delta"].as_str() {
                    self.text.push_str(delta);
                    text(delta);
                }
            }
            "response.reasoning_text.delta" | "response.reasoning_summary_text.delta" => {
                if let Some(delta) = event["delta"].as_str() {
                    self.thoughts.push_str(delta);
                    thought(delta);
                }
            }
            "response.output_item.added" | "response.output_item.done" => {
                let index = event["output_index"].as_u64().ok_or_else(|| {
                    AppError::Agent("Responses item is missing output_index".to_string())
                })?;
                self.output.insert(index, event["item"].clone());
            }
            "response.function_call_arguments.delta" | "response.function_call_arguments.done" => {
                let index = event["output_index"].as_u64().ok_or_else(|| {
                    AppError::Agent("Responses function call is missing output_index".to_string())
                })?;
                let item = self.output.get_mut(&index).ok_or_else(|| {
                    AppError::Agent(
                        "Responses arguments arrived before their function call".to_string(),
                    )
                })?;
                if kind.ends_with(".done") {
                    item["arguments"] = event["arguments"].clone();
                } else if let Some(delta) = event["delta"].as_str() {
                    let mut arguments = item["arguments"].as_str().unwrap_or("").to_string();
                    arguments.push_str(delta);
                    item["arguments"] = json!(arguments);
                }
            }
            "response.completed" => {
                let response = &event["response"];
                if response["status"]
                    .as_str()
                    .is_some_and(|status| status != "completed")
                {
                    return Err(AppError::Agent(format!(
                        "Responses returned unsuccessful status: {}",
                        response["status"]
                    )));
                }
                let items = response["output"].as_array().ok_or_else(|| {
                    AppError::Agent("Responses terminal event is missing output items".to_string())
                })?;
                self.output = items
                    .iter()
                    .enumerate()
                    .map(|(i, item)| (i as u64, item.clone()))
                    .collect();
                self.usage.prompt_tokens = response["usage"]["input_tokens"].as_u64().unwrap_or(0);
                self.usage.completion_tokens =
                    response["usage"]["output_tokens"].as_u64().unwrap_or(0);
                self.completed = true;
            }
            "response.incomplete" | "response.failed" | "error" => {
                let error = if kind == "response.failed" {
                    &event["response"]["error"]
                } else {
                    &event
                };
                if let Some(message) = crate::agent::chatgpt::inference_error(error) {
                    return Err(AppError::Agent(message));
                }
                return Err(AppError::Agent(format!(
                    "Responses stream {}: {}",
                    kind,
                    if kind == "response.incomplete" {
                        &event["response"]["incomplete_details"]
                    } else if kind == "response.failed" {
                        &event["response"]["error"]
                    } else {
                        &event
                    }
                )));
            }
            _ => {}
        }
        Ok(())
    }

    fn finish<FT: FnMut(&str), FC: FnMut(&str)>(
        mut self,
        model: String,
        endpoint: String,
        thought: &mut FT,
        text: &mut FC,
    ) -> Result<LlmChatResult, AppError> {
        if !self.completed {
            return Err(AppError::Agent(
                "Responses stream ended before response.completed; no tools were executed"
                    .to_string(),
            ));
        }
        let output: Vec<Value> = self.output.into_values().collect();
        let mut final_text = String::new();
        let mut final_thoughts = String::new();
        let mut calls = Vec::new();
        for item in &output {
            match item["type"].as_str().unwrap_or("") {
                "message" => {
                    if let Some(parts) = item["content"].as_array() {
                        for part in parts {
                            if let Some(value) =
                                part["text"].as_str().or_else(|| part["refusal"].as_str())
                            {
                                final_text.push_str(value);
                            }
                        }
                    }
                }
                "reasoning" => {
                    let parts = item["content"]
                        .as_array()
                        .filter(|parts| !parts.is_empty())
                        .or_else(|| item["summary"].as_array());
                    if let Some(parts) = parts {
                        for part in parts {
                            if let Some(value) = part["text"].as_str() {
                                final_thoughts.push_str(value);
                            }
                        }
                    }
                }
                "function_call" => {
                    let required = |key: &str| -> Result<String, AppError> {
                        item[key]
                            .as_str()
                            .filter(|value| !value.is_empty())
                            .map(str::to_owned)
                            .ok_or_else(|| {
                                AppError::Agent(format!(
                                    "Responses function call is missing {}",
                                    key
                                ))
                            })
                    };
                    let id = required("call_id")?;
                    if calls.iter().any(|call: &ToolCall| call.id == id) {
                        return Err(AppError::Agent(
                            "Responses returned duplicate call_id".to_string(),
                        ));
                    }
                    calls.push(ToolCall {
                        id,
                        call_type: "function".to_string(),
                        function: FunctionCall {
                            name: required("name")?,
                            arguments: required("arguments")?,
                        },
                    });
                }
                "custom_tool_call" => {
                    return Err(AppError::Agent(
                        "Unsupported custom tool call in Responses stream".to_string(),
                    ))
                }
                _ => {}
            }
        }
        // The terminal object is authoritative. Only emit a suffix not already streamed.
        if let Some(suffix) = final_text.strip_prefix(&self.text) {
            if !suffix.is_empty() {
                text(suffix);
            }
        } else {
            return Err(AppError::Agent(
                "Responses final text disagrees with streamed text".to_string(),
            ));
        }
        if self.thoughts.is_empty() && !final_thoughts.is_empty() {
            thought(&final_thoughts);
        }
        if final_thoughts.is_empty() {
            final_thoughts = self.thoughts;
        }
        if final_text.is_empty() && calls.is_empty() {
            return Err(AppError::Agent(
                "Responses completed without an answer or function calls".to_string(),
            ));
        }
        self.usage.reasoning_chars = final_thoughts.chars().count() as u64;
        let mut message = if calls.is_empty() {
            AgentMessage::assistant(final_text)
        } else {
            AgentMessage::assistant_with_tools(final_text, calls)
        };
        if !final_thoughts.is_empty() {
            message.reasoning_content = Some(final_thoughts);
        }
        message.response_replay = Some(ResponseReplay {
            auth_scope: None,
            model: model.clone(),
            endpoint,
            output,
        });
        Ok(LlmChatResult {
            message,
            usage: self.usage,
            provider: "remote".to_string(),
            model,
        })
    }
}

pub(super) async fn read_responses_stream<FT, FC>(
    mut response: reqwest::Response,
    model: String,
    endpoint: String,
    mut on_thought: FT,
    mut on_chunk: FC,
) -> Result<LlmChatResult, AppError>
where
    FT: FnMut(&str) + Send,
    FC: FnMut(&str) + Send,
{
    let mut decoder = SseDecoder::default();
    let mut state = ResponseStream::default();
    let mut size = 0usize;
    while let Some(chunk) = response
        .chunk()
        .await
        .map_err(|error| transient_error(format!("Error reading Responses stream: {}", error)))?
    {
        size = size.saturating_add(chunk.len());
        if size > 20 * 1024 * 1024 {
            return Err(AppError::Agent(
                "Responses stream exceeded 20 MiB".to_string(),
            ));
        }
        for data in decoder.push(&chunk)? {
            state.event(&data, &mut on_thought, &mut on_chunk)?;
        }
        if state.completed {
            break;
        }
    }
    if !state.completed {
        for data in decoder.finish()? {
            state.event(&data, &mut on_thought, &mut on_chunk)?;
        }
    }
    state.finish(model, endpoint, &mut on_thought, &mut on_chunk)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::agent::llm::LlmClient;

    fn event(value: Value) -> String {
        format!(
            "event: {}\r\ndata: {}\r\n\r\n",
            value["type"].as_str().unwrap(),
            value
        )
    }
    fn completed(output: Vec<Value>) -> Value {
        json!({"type":"response.completed", "response":{"status":"completed", "output":output,
            "usage":{"input_tokens":42,"output_tokens":12}}})
    }
    fn answer(text: &str) -> Value {
        json!({"type":"message", "id":"msg_1", "role":"assistant", "status":"completed", "phase":"final_answer", "content":[{"type":"output_text","text":text,"annotations":[]}]})
    }
    fn function() -> Value {
        json!({"type":"function_call", "id":"fc_1", "call_id":"call_1", "name":"calculate", "arguments":"{\"x\":1}", "status":"completed"})
    }
    fn reasoning(deepseek: bool) -> Value {
        if deepseek {
            json!({"type":"reasoning", "id":"rs_1", "summary":[], "content":[{"type":"reasoning_text","text":"计算"}]})
        } else {
            json!({"type":"reasoning", "id":"rs_1", "summary":[{"type":"summary_text","text":"计算"}], "encrypted_content":"opaque-reasoning"})
        }
    }

    #[test]
    fn endpoint_normalizes_roots_and_full_paths() {
        for (base, expected) in [
            (
                "https://api.deepseek.com",
                "https://api.deepseek.com/responses",
            ),
            (
                "https://api.openai.com",
                "https://api.openai.com/v1/responses",
            ),
            (
                "https://api.openai.com/v1/",
                "https://api.openai.com/v1/responses",
            ),
            (
                "https://gateway.test/api/chat/completions",
                "https://gateway.test/api/responses",
            ),
            (
                "https://gateway.test/v1/responses",
                "https://gateway.test/v1/responses",
            ),
        ] {
            assert_eq!(remote_endpoint(base, true), expected);
        }
        assert_eq!(
            remote_endpoint("https://gateway.test/v1/responses", false),
            "https://gateway.test/v1/chat/completions"
        );
    }

    #[test]
    fn payload_maps_tools_and_model_specific_reasoning() {
        let mut config = AiConfig::default();
        let tool = ToolDefinition {
            tool_type: "function".into(),
            function: crate::agent::FunctionDefinition {
                name: "calculate".into(),
                description: "Calculate".into(),
                parameters: json!({"type":"object","properties":{"x":{"type":"number"}}}),
            },
        };
        let (_, payload) =
            build_responses_payload(&config, &[AgentMessage::user("hi")], &[tool]).unwrap();
        assert_eq!(payload["reasoning"]["effort"], "high");
        assert_eq!(payload["max_output_tokens"], 65_536);
        assert_eq!(payload["tools"][0]["name"], "calculate");
        assert_eq!(payload["tools"][0]["strict"], false);
        assert!(payload["tools"][0].get("function").is_none());
        assert!(payload.get("messages").is_none() && payload.get("stream_options").is_none());
        assert!(payload.get("temperature").is_none());
        config.remote.thinking_mode = "disabled".into();
        let (_, payload) = build_responses_payload(&config, &[], &[]).unwrap();
        assert_eq!(payload["reasoning"]["effort"], "none");
        assert!(payload.get("top_p").is_none());
        config.remote.chat_model = "gpt-6.1-sol".into();
        config.remote.base_url = "https://api.openai.com/v1".into();
        assert!(build_responses_payload(&config, &[], &[]).is_err());
        config.remote.thinking_mode = "auto".into();
        config.remote.reasoning_model = "old-reasoner".into();
        config.remote.reasoning_effort = "max".into();
        let (model, payload) = build_responses_payload(&config, &[], &[]).unwrap();
        assert_eq!(model, "gpt-6.1-sol");
        assert_eq!(payload["reasoning"]["effort"], "max");
        assert_eq!(payload["include"][0], "reasoning.encrypted_content");
        assert_eq!(payload["store"], false);
        assert!(payload.get("top_p").is_none());
    }

    #[test]
    fn subscription_payload_uses_developer_messages_and_namespaced_tools() {
        let mut config = AiConfig::default();
        config.remote.auth_mode = "chatgpt".into();
        config.remote.chatgpt_profile_id = "account-a".into();
        config.remote.chat_model = "gpt-6.1-sol".into();
        config.remote.base_url = crate::agent::chatgpt::API_BASE.into();
        let tool = ToolDefinition {
            tool_type: "function".into(),
            function: crate::agent::FunctionDefinition {
                name: "calculate".into(),
                description: "Calculate".into(),
                parameters: json!({"type":"object","properties":{}}),
            },
        };
        let (_, payload) = build_responses_payload(
            &config,
            &[
                AgentMessage::system("instructions"),
                AgentMessage::user("hello"),
            ],
            &[tool],
        )
        .unwrap();
        assert_eq!(payload["input"][0]["role"], "developer");
        assert_eq!(payload["tools"][0]["type"], "namespace");
        assert_eq!(payload["tools"][0]["tools"][0]["name"], "calculate");
        for key in [
            "max_output_tokens",
            "temperature",
            "top_p",
            "previous_response_id",
        ] {
            assert!(payload.get(key).is_none());
        }
        assert_eq!(payload["store"], false);
        assert_eq!(payload["stream"], true);
        let mut message = AgentMessage::assistant_with_tools("", vec![]);
        message.response_replay = Some(ResponseReplay {
            auth_scope: Some("chatgpt:account-a".into()),
            model: "gpt-6.1-sol".into(),
            endpoint: remote_endpoint(crate::agent::chatgpt::API_BASE, true),
            output: vec![reasoning(false)],
        });
        let history = [message];
        let same = response_input(
            &history,
            "gpt-6.1-sol",
            &remote_endpoint(crate::agent::chatgpt::API_BASE, true),
            false,
            Some("chatgpt:account-a"),
        );
        assert_eq!(same[0]["encrypted_content"], "opaque-reasoning");
        let other = response_input(
            &history,
            "gpt-6.1-sol",
            &remote_endpoint(crate::agent::chatgpt::API_BASE, true),
            false,
            Some("chatgpt:account-b"),
        );
        assert!(other.is_empty());
    }

    #[test]
    fn decoder_preserves_split_utf8_and_multiline_sse() {
        let raw = "event: example\r\ndata: {\"text\":\"中文\",\r\ndata: \"ok\":true}\r\n\r\n";
        let mut decoder = SseDecoder::default();
        let mut data = Vec::new();
        for byte in raw.as_bytes() {
            data.extend(decoder.push(&[*byte]).unwrap());
        }
        data.extend(decoder.finish().unwrap());
        assert_eq!(data.len(), 1);
        assert_eq!(
            serde_json::from_str::<Value>(&data[0]).unwrap()["text"],
            "中文"
        );
    }

    #[test]
    fn stream_rejects_failure_truncation_and_missing_terminal() {
        for failure in [
            json!({"type":"response.incomplete", "response":{"incomplete_details":{"reason":"max_output_tokens"}}}),
            json!({"type":"response.failed", "response":{"error":{"message":"failed"}}}),
            json!({"type":"error", "message":"invalid request"}),
        ] {
            assert!(ResponseStream::default()
                .event(&failure.to_string(), &mut |_| {}, &mut |_| {})
                .is_err());
        }
        let mut state = ResponseStream::default();
        state
            .event(
                &json!({"type":"response.output_text.delta","delta":"partial"}).to_string(),
                &mut |_| {},
                &mut |_| {},
            )
            .unwrap();
        assert!(state
            .finish("model".into(), "endpoint".into(), &mut |_| {}, &mut |_| {})
            .is_err());
    }

    #[test]
    fn replay_is_serialized_and_scoped_to_model_and_endpoint() {
        let mut message = AgentMessage::assistant_with_tools(
            "",
            vec![ToolCall {
                id: "call_1".into(),
                call_type: "function".into(),
                function: FunctionCall {
                    name: "calculate".into(),
                    arguments: "{\"x\":1}".into(),
                },
            }],
        );
        message.response_replay = Some(ResponseReplay {
            auth_scope: None,
            model: "gpt-6.1-sol".into(),
            endpoint: "https://api.openai.com/v1/responses".into(),
            output: vec![reasoning(false), function()],
        });
        let restored: AgentMessage =
            serde_json::from_value(serde_json::to_value(&message).unwrap()).unwrap();
        let history = [
            restored,
            AgentMessage::tool_result("call_1", "calculate", "2"),
        ];
        let input = response_input(
            &history,
            "gpt-6.1-sol",
            "https://api.openai.com/v1/responses",
            false,
            None,
        );
        assert_eq!(input[0]["encrypted_content"], "opaque-reasoning");
        assert_eq!(input[1]["call_id"], input[2]["call_id"]);
        for (model, endpoint) in [
            ("deepseek-flash", "https://api.deepseek.com/responses"),
            ("gpt-6.1-sol", "https://gateway.test/responses"),
        ] {
            let input = response_input(&history, model, endpoint, false, None);
            assert!(!input.iter().any(|item| item["type"] == "reasoning"));
            assert_eq!(input[0]["type"], "function_call");
        }
    }

    #[tokio::test]
    async fn default_responses_streams_parallel_calls_and_replays_next_turn() {
        for deepseek in [true, false] {
            let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
            let address = listener.local_addr().unwrap();
            let rs = reasoning(deepseek);
            let fc = function();
            let mut fc2 = fc.clone();
            fc2["call_id"] = json!("call_2");
            fc2["id"] = json!("fc_2");
            let rs_server = rs.clone();
            let fc_server = fc.clone();
            let fc2_server = fc2.clone();
            let server = tokio::spawn(async move {
                use tokio::io::{AsyncReadExt, AsyncWriteExt};
                for turn in 0..2 {
                    let (mut socket, _) = listener.accept().await.unwrap();
                    let mut request = Vec::new();
                    let mut buffer = [0u8; 4096];
                    let header_end = loop {
                        let n = socket.read(&mut buffer).await.unwrap();
                        assert!(n > 0);
                        request.extend_from_slice(&buffer[..n]);
                        if let Some(end) = request.windows(4).position(|part| part == b"\r\n\r\n") {
                            break end + 4;
                        }
                    };
                    let headers = String::from_utf8_lossy(&request[..header_end]);
                    assert!(headers.starts_with("POST /v1/responses HTTP/1.1"));
                    let length: usize = headers
                        .lines()
                        .find_map(|line| {
                            line.to_ascii_lowercase()
                                .strip_prefix("content-length:")
                                .map(str::trim)
                                .map(str::to_owned)
                        })
                        .unwrap()
                        .parse()
                        .unwrap();
                    while request.len() < header_end + length {
                        let n = socket.read(&mut buffer).await.unwrap();
                        assert!(n > 0);
                        request.extend_from_slice(&buffer[..n]);
                    }
                    let body: Value =
                        serde_json::from_slice(&request[header_end..header_end + length]).unwrap();
                    assert_eq!(body["store"], false);
                    if turn == 1 {
                        assert_eq!(body["input"][1], rs_server);
                        assert_eq!(body["input"][2], fc_server);
                        assert_eq!(body["input"][3], fc2_server);
                        assert_eq!(body["input"][4]["type"], "function_call_output");
                        assert_eq!(body["input"][4]["call_id"], "call_1");
                        assert_eq!(body["input"][5]["call_id"], "call_2");
                    }
                    let response = if turn == 0 {
                        let mut partial_fc = fc_server.clone();
                        partial_fc["arguments"] = json!("");
                        let mut partial_fc2 = fc2_server.clone();
                        partial_fc2["arguments"] = json!("");
                        [
                            json!({"type":if deepseek {"response.reasoning_text.delta"} else {"response.reasoning_summary_text.delta"},"delta":"计算"}),
                            json!({"type":"response.output_item.added","output_index":1,"item":partial_fc}),
                            json!({"type":"response.output_item.added","output_index":2,"item":partial_fc2}),
                            json!({"type":"response.function_call_arguments.delta","output_index":2,"delta":"{\"x\":"}),
                            json!({"type":"response.function_call_arguments.delta","output_index":1,"delta":"{\"x\":1}"}),
                            json!({"type":"response.function_call_arguments.done","output_index":2,"arguments":"{\"x\":1}"}),
                            json!({"type":"response.output_item.done","output_index":1,"item":fc_server}),
                            completed(vec![rs_server.clone(),fc_server.clone(),fc2_server.clone()]),
                        ].into_iter().map(event).collect::<String>()
                    } else {
                        [
                            json!({"type":"response.output_text.delta", "delta":"结果为二"}),
                            completed(vec![answer("结果为二")]),
                        ]
                        .into_iter()
                        .map(event)
                        .collect::<String>()
                    };
                    let headers = format!("HTTP/1.1 200 OK\r\nContent-Type: text/event-stream\r\nTransfer-Encoding: chunked\r\nConnection: close\r\n\r\n");
                    socket.write_all(headers.as_bytes()).await.unwrap();
                    // Single-byte transport chunks deliberately split Chinese UTF-8 and SSE fields.
                    for byte in response.as_bytes() {
                        socket
                            .write_all(&[b'1', b'\r', b'\n', *byte, b'\r', b'\n'])
                            .await
                            .unwrap();
                    }
                    socket.write_all(b"0\r\n\r\n").await.unwrap();
                }
            });
            let mut config = AiConfig::default();
            config.remote.base_url = format!("http://{}/v1", address);
            if !deepseek {
                config.remote.chat_model = "gpt-6.1-sol".into();
            }
            config.resilience.fallback_enabled = false;
            let client = LlmClient::new();
            let mut history = vec![AgentMessage::user("calculate")];
            let mut thoughts = String::new();
            let first = client
                .stream_chat_with_thoughts(
                    &config,
                    &history,
                    &[],
                    |chunk| thoughts.push_str(chunk),
                    |_| {},
                )
                .await
                .unwrap();
            assert_eq!(thoughts, "计算");
            assert_eq!(first.message.tool_calls.as_ref().unwrap().len(), 2);
            assert_eq!(
                first.message.response_replay.as_ref().unwrap().output,
                vec![rs, fc, fc2]
            );
            history.push(first.message);
            history.push(AgentMessage::tool_result("call_1", "calculate", "2"));
            history.push(AgentMessage::tool_result("call_2", "calculate", "2"));
            let mut streamed = String::new();
            let result = client
                .stream_chat(&config, &history, &[], |chunk| streamed.push_str(chunk))
                .await
                .unwrap();
            assert_eq!(streamed, "结果为二");
            assert_eq!(result.message.content, "结果为二");
            assert_eq!(result.usage.prompt_tokens, 42);
            assert_eq!(result.usage.completion_tokens, 12);
            assert_eq!(
                result.message.response_replay.as_ref().unwrap().output[0]["phase"],
                "final_answer"
            );
            server.await.unwrap();
        }
    }
}
