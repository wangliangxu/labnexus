//! Context-window management: history bounding, compaction and token estimates.

use super::redact::redact_trace_text;
use crate::agent::types::*;

pub(super) fn truncate_text(value: &str, max_chars: usize) -> String {
    if value.chars().count() <= max_chars {
        return value.to_string();
    }
    let truncated: String = value.chars().take(max_chars).collect();
    format!(
        "{}\n...[truncated after {} characters]",
        truncated, max_chars
    )
}

pub(super) fn bounded_history(
    history: &[AgentMessage],
    summary: &str,
    max_tokens: usize,
) -> Vec<AgentMessage> {
    let total: usize = history.iter().map(message_token_estimate).sum();
    if total <= max_tokens {
        return history.to_vec();
    }

    let system = history.iter().find(|message| message.role == "system");
    let system_budget = (max_tokens / 4).clamp(16, 4_096);
    let mut result = Vec::new();
    let mut used = 0usize;
    if let Some(system) = system {
        let compacted = compact_message(system, system_budget);
        used = used.saturating_add(message_token_estimate(&compacted));
        result.push(compacted);
    }

    if !summary.is_empty() && used < max_tokens {
        let summary_budget = (max_tokens / 5).clamp(16, 3_000);
        let summary_message = AgentMessage::system(format!(
            "[Persisted conversation summary]\n{}",
            truncate_to_token_budget(summary, summary_budget)
        ));
        used = used.saturating_add(message_token_estimate(&summary_message));
        result.push(summary_message);
    }

    let non_system_start = history
        .iter()
        .position(|message| message.role != "system")
        .unwrap_or(history.len());
    let mut turns = Vec::<&[AgentMessage]>::new();
    let mut turn_start = non_system_start;
    for index in non_system_start + 1..history.len() {
        if history[index].role == "user" {
            turns.push(&history[turn_start..index]);
            turn_start = index;
        }
    }
    if turn_start < history.len() {
        turns.push(&history[turn_start..]);
    }

    let mut selected = Vec::<Vec<AgentMessage>>::new();
    for (reverse_index, turn) in turns.iter().rev().enumerate() {
        let turn_tokens: usize = turn.iter().map(message_token_estimate).sum();
        let remaining = max_tokens.saturating_sub(used);
        if turn_tokens <= remaining {
            selected.push(turn.to_vec());
            used = used.saturating_add(turn_tokens);
        } else if reverse_index == 0 && remaining > 0 {
            selected.push(compact_turn(turn, remaining));
            break;
        } else {
            break;
        }
    }
    selected.reverse();
    for turn in selected {
        result.extend(turn);
    }
    result
}

pub(super) fn compact_turn(turn: &[AgentMessage], budget: usize) -> Vec<AgentMessage> {
    let mut compacted = turn.to_vec();
    for message in &mut compacted {
        if message.response_replay.is_some() {
            continue;
        }
        if let Some(calls) = &mut message.tool_calls {
            for call in calls {
                if estimate_text_tokens(&call.function.arguments) > 32 {
                    call.function.arguments = "{\"_truncated\":true}".to_string();
                }
            }
        }
    }
    let preserved: usize = compacted
        .iter()
        .filter(|message| message.response_replay.is_some())
        .map(message_token_estimate)
        .sum();
    let editable: Vec<_> = compacted
        .iter_mut()
        .filter(|message| message.response_replay.is_none())
        .collect();
    let metadata: usize = editable
        .iter()
        .map(|message| {
            message_token_estimate(message).saturating_sub(estimate_text_tokens(&message.content))
        })
        .sum();
    let content_budget = budget.saturating_sub(preserved).saturating_sub(metadata);
    let per_message = content_budget / editable.len().max(1);
    for message in editable {
        message.content = truncate_to_token_budget(&message.content, per_message.max(1));
    }
    compacted
}

pub(super) fn compact_message(message: &AgentMessage, budget: usize) -> AgentMessage {
    if message.response_replay.is_some() {
        return message.clone();
    }
    let mut compacted = message.clone();
    if let Some(calls) = &mut compacted.tool_calls {
        for call in calls {
            if estimate_text_tokens(&call.function.arguments) > budget / 2 {
                call.function.arguments = "{\"_truncated\":true}".to_string();
            }
        }
    }
    let metadata_tokens =
        message_token_estimate(&compacted).saturating_sub(estimate_text_tokens(&compacted.content));
    compacted.content = truncate_to_token_budget(
        &compacted.content,
        budget.saturating_sub(metadata_tokens).max(16),
    );
    compacted
}

pub(super) fn truncate_to_token_budget(value: &str, max_tokens: usize) -> String {
    if estimate_text_tokens(value) <= max_tokens {
        return value.to_string();
    }
    if max_tokens < 8 {
        return value.chars().take(max_tokens).collect();
    }
    let mut char_limit = value.chars().count().min(max_tokens.saturating_mul(3));
    let mut truncated: String = value.chars().take(char_limit).collect();
    while estimate_text_tokens(&truncated) > max_tokens && char_limit > 16 {
        char_limit = char_limit.saturating_mul(4) / 5;
        truncated = value.chars().take(char_limit).collect();
    }
    format!("{}\n...[context compacted]", truncated)
}

pub(super) fn build_session_summary(history: &[AgentMessage]) -> String {
    let mut goals = Vec::new();
    let mut conclusions = Vec::new();
    let mut tool_state = Vec::new();
    for message in history.iter().rev() {
        match message.role.as_str() {
            "user" if goals.len() < 6 => {
                let content = message
                    .content
                    .split("\n\n<untrusted_workspace_context>")
                    .next()
                    .unwrap_or(&message.content);
                let content = redact_trace_text(content.trim(), 600);
                if !content.is_empty() && !goals.contains(&content) {
                    goals.push(content);
                }
            }
            "assistant" if conclusions.len() < 6 && !message.content.trim().is_empty() => {
                let content = redact_trace_text(message.content.trim(), 800);
                if !conclusions.contains(&content) {
                    conclusions.push(content);
                }
            }
            "tool" if tool_state.len() < 8 => {
                tool_state.push(format!(
                    "{}: {}",
                    message.name.as_deref().unwrap_or("tool"),
                    redact_trace_text(message.content.trim(), 400)
                ));
            }
            _ => {}
        }
        if goals.len() >= 6 && conclusions.len() >= 6 && tool_state.len() >= 8 {
            break;
        }
    }
    goals.reverse();
    conclusions.reverse();
    tool_state.reverse();
    let mut sections = vec!["## Structured session memory".to_string()];
    if !goals.is_empty() {
        sections.push(format!("### Goals and requests\n- {}", goals.join("\n- ")));
    }
    if !conclusions.is_empty() {
        sections.push(format!(
            "### Decisions and conclusions\n- {}",
            conclusions.join("\n- ")
        ));
    }
    if !tool_state.is_empty() {
        sections.push(format!(
            "### Tool and execution state\n- {}",
            tool_state.join("\n- ")
        ));
    }
    truncate_text(&sections.join("\n\n"), 12_000)
}

pub(super) fn message_token_estimate(message: &AgentMessage) -> usize {
    if let Some(replay) = &message.response_replay {
        return estimate_text_tokens(&serde_json::to_string(&replay.output).unwrap_or_default())
            + 8;
    }
    let tool_size: usize = message
        .tool_calls
        .as_ref()
        .map(|calls| {
            calls
                .iter()
                .map(|call| {
                    estimate_text_tokens(&call.function.name)
                        + estimate_text_tokens(&call.function.arguments)
                        + estimate_text_tokens(&call.id)
                })
                .sum()
        })
        .unwrap_or_default();
    estimate_text_tokens(&message.content)
        + tool_size
        + message
            .reasoning_content
            .as_deref()
            .map(estimate_text_tokens)
            .unwrap_or(0)
        + 8
}

pub(super) fn estimate_text_tokens(value: &str) -> usize {
    let mut ascii = 0usize;
    let mut non_ascii = 0usize;
    let mut punctuation = 0usize;
    for character in value.chars() {
        if character.is_ascii_alphanumeric() || character.is_ascii_whitespace() {
            ascii += 1;
        } else if character.is_ascii() {
            punctuation += 1;
        } else {
            non_ascii += 1;
        }
    }
    ascii.div_ceil(4) + punctuation.div_ceil(2) + non_ascii + 1
}
