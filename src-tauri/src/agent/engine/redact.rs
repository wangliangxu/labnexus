//! Redaction of secrets in agent traces.

use super::context::truncate_text;

pub(super) fn redact_trace_text(value: &str, max_chars: usize) -> String {
    let sensitive = [
        "api_key",
        "apikey",
        "authorization",
        "password",
        "secret",
        "access_token",
        "refresh_token",
    ];
    let redacted = value
        .lines()
        .map(|line| {
            let lower = line.to_lowercase();
            if sensitive.iter().any(|marker| lower.contains(marker)) {
                let split = line.find('=').or_else(|| line.find(':'));
                split
                    .map(|index| format!("{}: [REDACTED]", &line[..index]))
                    .unwrap_or_else(|| "[REDACTED SENSITIVE LINE]".to_string())
            } else {
                line.to_string()
            }
        })
        .collect::<Vec<_>>()
        .join("\n");
    truncate_text(&redacted, max_chars)
}

pub(super) fn redact_json(value: &serde_json::Value) -> serde_json::Value {
    match value {
        serde_json::Value::Object(object) => serde_json::Value::Object(
            object
                .iter()
                .map(|(key, value)| {
                    let lower = key.to_lowercase();
                    let sensitive = ["key", "token", "password", "secret", "authorization"]
                        .iter()
                        .any(|marker| lower.contains(marker));
                    (
                        key.clone(),
                        if sensitive {
                            serde_json::Value::String("[REDACTED]".to_string())
                        } else {
                            redact_json(value)
                        },
                    )
                })
                .collect(),
        ),
        serde_json::Value::Array(values) => {
            serde_json::Value::Array(values.iter().map(redact_json).collect())
        }
        _ => value.clone(),
    }
}
