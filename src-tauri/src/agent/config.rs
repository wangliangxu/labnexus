//! LabNexus — AI Provider configuration management.
//!
//! Stores and loads configuration from `~/.labnexus/config/ai.json`.
//! Supports Hybrid LLM strategy: Remote API (OpenAI / DeepSeek) & Local Ollama / llama.cpp.

use crate::error::AppError;
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;
#[cfg(target_os = "macos")]
use std::process::Command;

#[cfg(target_os = "macos")]
const KEYCHAIN_SERVICE: &str = "com.labnexus.ai";
#[cfg(target_os = "macos")]
const KEYCHAIN_ACCOUNT: &str = "remote-api-key";

/// Top-level AI configuration.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AiConfig {
    /// Active provider: "remote" | "ollama"
    pub provider: String,
    pub remote: RemoteApiConfig,
    pub ollama: OllamaConfig,
    #[serde(default)]
    pub resilience: ResilienceConfig,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RemoteApiConfig {
    pub enabled: bool,
    pub api_key: String,
    pub base_url: String, // e.g. "https://api.deepseek.com" or "https://api.openai.com/v1"
    pub chat_model: String, // e.g. "deepseek-flash" or "deepseek-chat" or "gpt-4.1"
    pub reasoning_model: String, // e.g. "deepseek-reasoner"
    pub temperature: f32,
    pub top_p: f32,
    pub timeout_seconds: u64,
    #[serde(default = "default_remote_context_tokens")]
    pub context_window_tokens: u32,
    #[serde(default = "default_remote_output_tokens")]
    pub max_output_tokens: u32,
    #[serde(default = "default_thinking_mode")]
    pub thinking_mode: String, // "auto" | "enabled" | "disabled"
    #[serde(default = "default_reasoning_effort")]
    pub reasoning_effort: String, // "low" | "medium" | "high" | "max"
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OllamaConfig {
    pub enabled: bool,
    pub base_url: String,   // e.g. "http://127.0.0.1:11434"
    pub chat_model: String, // e.g. "qwen2.5-coder:7b"
    pub temperature: f32,
    pub top_p: f32,
    pub timeout_seconds: u64,
    #[serde(default = "default_ollama_context_tokens")]
    pub context_window_tokens: u32,
    #[serde(default = "default_output_tokens")]
    pub max_output_tokens: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ResilienceConfig {
    pub fallback_enabled: bool,
    pub max_retries: u32,
    pub retry_base_delay_ms: u64,
    pub circuit_breaker_threshold: u32,
    pub circuit_breaker_cooldown_seconds: u64,
}

impl Default for AiConfig {
    fn default() -> Self {
        Self {
            provider: "remote".to_string(),
            remote: RemoteApiConfig::default(),
            ollama: OllamaConfig::default(),
            resilience: ResilienceConfig::default(),
        }
    }
}

impl Default for RemoteApiConfig {
    fn default() -> Self {
        Self {
            enabled: true,
            api_key: "".to_string(),
            base_url: "https://api.deepseek.com".to_string(),
            chat_model: "deepseek-flash".to_string(),
            reasoning_model: "deepseek-reasoner".to_string(),
            temperature: 0.2,
            top_p: 0.95,
            timeout_seconds: 120,
            context_window_tokens: default_remote_context_tokens(),
            max_output_tokens: default_remote_output_tokens(),
            thinking_mode: default_thinking_mode(),
            reasoning_effort: default_reasoning_effort(),
        }
    }
}

impl Default for OllamaConfig {
    fn default() -> Self {
        Self {
            enabled: false,
            base_url: "http://127.0.0.1:11434".to_string(),
            chat_model: "qwen2.5-coder:7b".to_string(),
            temperature: 0.2,
            top_p: 0.9,
            timeout_seconds: 120,
            context_window_tokens: default_ollama_context_tokens(),
            max_output_tokens: default_output_tokens(),
        }
    }
}

impl Default for ResilienceConfig {
    fn default() -> Self {
        Self {
            fallback_enabled: true,
            max_retries: 2,
            retry_base_delay_ms: 500,
            circuit_breaker_threshold: 3,
            circuit_breaker_cooldown_seconds: 30,
        }
    }
}

fn default_remote_context_tokens() -> u32 {
    128_000
}

fn default_remote_output_tokens() -> u32 {
    8_192
}

fn default_thinking_mode() -> String {
    "auto".to_string()
}

fn default_reasoning_effort() -> String {
    "medium".to_string()
}

fn default_ollama_context_tokens() -> u32 {
    16_384
}

fn default_output_tokens() -> u32 {
    4_096
}

/// Resolve the path to `~/.labnexus/config/ai.json`.
pub fn get_config_path() -> PathBuf {
    let home = std::env::var("HOME")
        .or_else(|_| std::env::var("USERPROFILE"))
        .unwrap_or_else(|_| ".".to_string());
    let mut path = PathBuf::from(home);
    path.push(".labnexus");
    path.push("config");
    path.push("ai.json");
    path
}

/// Load AI configuration from disk. Returns default if file is missing or invalid.
pub fn load_ai_config() -> AiConfig {
    let path = get_config_path();
    let mut config = if !path.exists() {
        AiConfig::default()
    } else {
        match fs::read_to_string(&path) {
            Ok(content) => match serde_json::from_str(&content) {
                Ok(config) => match validate_ai_config(&config) {
                    Ok(()) => config,
                    Err(error) => {
                        log::warn!("Invalid AI config in {:?}: {}. Using default.", path, error);
                        AiConfig::default()
                    }
                },
                Err(e) => {
                    log::warn!(
                        "Failed to parse AI config from {:?}: {}. Using default.",
                        path,
                        e
                    );
                    AiConfig::default()
                }
            },
            Err(e) => {
                log::warn!(
                    "Failed to read AI config from {:?}: {}. Using default.",
                    path,
                    e
                );
                AiConfig::default()
            }
        }
    };

    #[cfg(target_os = "macos")]
    {
        if config.remote.api_key.is_empty() {
            match load_keychain_api_key() {
                Ok(Some(secret)) => config.remote.api_key = secret,
                Ok(None) => {}
                Err(error) => log::warn!("Failed to load API key from Keychain: {}", error),
            }
        } else {
            // One-time migration from legacy plaintext config.
            match save_keychain_api_key(&config.remote.api_key) {
                Ok(()) => {
                    let mut sanitized = config.clone();
                    sanitized.remote.api_key.clear();
                    if let Err(error) = write_config_file(&sanitized) {
                        log::warn!("Failed to remove migrated API key from config: {}", error);
                    }
                }
                Err(error) => log::warn!("Failed to migrate API key to Keychain: {}", error),
            }
        }
    }

    config
}

/// Save AI configuration to disk.
pub fn save_ai_config(config: &AiConfig) -> Result<(), AppError> {
    validate_ai_config(config)?;
    let mut disk_config = config.clone();
    #[cfg(target_os = "macos")]
    {
        save_keychain_api_key(&config.remote.api_key).map_err(AppError::Agent)?;
        disk_config.remote.api_key.clear();
    }
    write_config_file(&disk_config)
}

fn write_config_file(config: &AiConfig) -> Result<(), AppError> {
    let path = get_config_path();
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| {
            AppError::Agent(format!(
                "Failed to create config directory {:?}: {}",
                parent, e
            ))
        })?;
    }
    let content = serde_json::to_string_pretty(config)
        .map_err(|e| AppError::Serialization(format!("Failed to serialize AI config: {}", e)))?;
    let temp_path = path.with_extension("json.tmp");
    fs::write(&temp_path, content).map_err(|e| {
        AppError::Agent(format!(
            "Failed to write temporary AI config {:?}: {}",
            temp_path, e
        ))
    })?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(&temp_path, fs::Permissions::from_mode(0o600)).map_err(|e| {
            AppError::Agent(format!(
                "Failed to secure AI config permissions {:?}: {}",
                temp_path, e
            ))
        })?;
    }
    fs::rename(&temp_path, &path)
        .map_err(|e| AppError::Agent(format!("Failed to replace AI config {:?}: {}", path, e)))?;
    Ok(())
}

#[cfg(target_os = "macos")]
pub fn load_keychain_secret(service: &str, account: &str) -> Result<Option<String>, String> {
    let output = Command::new("security")
        .args([
            "find-generic-password",
            "-a",
            account,
            "-s",
            service,
            "-w",
        ])
        .output()
        .map_err(|error| format!("Could not start macOS security tool: {}", error))?;
    if output.status.success() {
        let secret = String::from_utf8_lossy(&output.stdout).trim().to_string();
        return Ok((!secret.is_empty()).then_some(secret));
    }
    let error = String::from_utf8_lossy(&output.stderr);
    if error.contains("could not be found") {
        Ok(None)
    } else {
        Err(error.trim().to_string())
    }
}

#[cfg(not(target_os = "macos"))]
pub fn load_keychain_secret(_service: &str, _account: &str) -> Result<Option<String>, String> {
    Ok(None)
}

#[cfg(target_os = "macos")]
pub fn save_keychain_secret(service: &str, account: &str, secret: &str) -> Result<(), String> {
    if secret.is_empty() {
        let output = Command::new("security")
            .args([
                "delete-generic-password",
                "-a",
                account,
                "-s",
                service,
            ])
            .output()
            .map_err(|error| format!("Could not start macOS security tool: {}", error))?;
        let error = String::from_utf8_lossy(&output.stderr);
        if output.status.success() || error.contains("could not be found") {
            return Ok(());
        }
        return Err(error.trim().to_string());
    }

    let output = Command::new("security")
        .args([
            "add-generic-password",
            "-U",
            "-a",
            account,
            "-s",
            service,
            "-w",
            secret,
        ])
        .output()
        .map_err(|error| format!("Could not start macOS security tool: {}", error))?;
    if output.status.success() {
        Ok(())
    } else {
        Err(String::from_utf8_lossy(&output.stderr).trim().to_string())
    }
}

#[cfg(not(target_os = "macos"))]
pub fn save_keychain_secret(_service: &str, _account: &str, _secret: &str) -> Result<(), String> {
    Ok(())
}

#[cfg(target_os = "macos")]
fn load_keychain_api_key() -> Result<Option<String>, String> {
    load_keychain_secret(KEYCHAIN_SERVICE, KEYCHAIN_ACCOUNT)
}

#[cfg(target_os = "macos")]
fn save_keychain_api_key(secret: &str) -> Result<(), String> {
    save_keychain_secret(KEYCHAIN_SERVICE, KEYCHAIN_ACCOUNT, secret)
}

fn validate_ai_config(config: &AiConfig) -> Result<(), AppError> {
    if config.provider != "remote" && config.provider != "ollama" {
        return Err(AppError::Agent(format!(
            "Unsupported AI provider '{}'",
            config.provider
        )));
    }
    for (name, base_url, model, temperature, top_p, timeout) in [
        (
            "remote",
            &config.remote.base_url,
            &config.remote.chat_model,
            config.remote.temperature,
            config.remote.top_p,
            config.remote.timeout_seconds,
        ),
        (
            "ollama",
            &config.ollama.base_url,
            &config.ollama.chat_model,
            config.ollama.temperature,
            config.ollama.top_p,
            config.ollama.timeout_seconds,
        ),
    ] {
        let parsed = url::Url::parse(base_url)
            .map_err(|error| AppError::Agent(format!("Invalid {} base URL: {}", name, error)))?;
        if parsed.scheme() != "http" && parsed.scheme() != "https" {
            return Err(AppError::Agent(format!(
                "{} base URL must use http or https",
                name
            )));
        }
        if model.trim().is_empty() {
            return Err(AppError::Agent(format!(
                "{} chat model cannot be empty",
                name
            )));
        }
        if !(0.0..=2.0).contains(&temperature) || !(0.0..=1.0).contains(&top_p) {
            return Err(AppError::Agent(format!(
                "Invalid sampling settings for {} provider",
                name
            )));
        }
        if !(1..=600).contains(&timeout) {
            return Err(AppError::Agent(format!(
                "{} timeout must be between 1 and 600 seconds",
                name
            )));
        }
    }
    for (name, context, output) in [
        (
            "remote",
            config.remote.context_window_tokens,
            config.remote.max_output_tokens,
        ),
        (
            "ollama",
            config.ollama.context_window_tokens,
            config.ollama.max_output_tokens,
        ),
    ] {
        if !(2_048..=2_000_000).contains(&context) {
            return Err(AppError::Agent(format!(
                "{} context window must be between 2048 and 2000000 tokens",
                name
            )));
        }
        if output < 256 || output >= context {
            return Err(AppError::Agent(format!(
                "{} output budget must be at least 256 tokens and smaller than its context window",
                name
            )));
        }
    }
    if !matches!(
        config.remote.thinking_mode.as_str(),
        "auto" | "enabled" | "disabled"
    ) {
        return Err(AppError::Agent(format!(
            "Unsupported thinking mode '{}'",
            config.remote.thinking_mode
        )));
    }
    if !matches!(
        config.remote.reasoning_effort.as_str(),
        "low" | "medium" | "high" | "max"
    ) {
        return Err(AppError::Agent(format!(
            "Unsupported reasoning effort '{}'",
            config.remote.reasoning_effort
        )));
    }
    if config.resilience.max_retries > 8
        || !(50..=60_000).contains(&config.resilience.retry_base_delay_ms)
        || !(1..=20).contains(&config.resilience.circuit_breaker_threshold)
        || !(1..=3_600).contains(&config.resilience.circuit_breaker_cooldown_seconds)
    {
        return Err(AppError::Agent(
            "Invalid provider resilience settings".to_string(),
        ));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::{validate_ai_config, AiConfig};

    #[test]
    fn rejects_unknown_provider() {
        let mut config = AiConfig::default();
        config.provider = "unknown".to_string();
        assert!(validate_ai_config(&config).is_err());
    }

    #[test]
    fn older_config_receives_context_and_resilience_defaults() {
        let config: AiConfig = serde_json::from_value(serde_json::json!({
            "provider": "remote",
            "remote": {
                "enabled": true, "api_key": "", "base_url": "https://example.com/v1",
                "chat_model": "model", "reasoning_model": "reasoner",
                "temperature": 0.2, "top_p": 0.9, "timeout_seconds": 60
            },
            "ollama": {
                "enabled": false, "base_url": "http://127.0.0.1:11434",
                "chat_model": "model", "temperature": 0.2, "top_p": 0.9,
                "timeout_seconds": 120
            }
        }))
        .unwrap();
        assert_eq!(config.remote.context_window_tokens, 128_000);
        assert_eq!(config.remote.max_output_tokens, 8_192);
        assert_eq!(config.remote.thinking_mode, "auto");
        assert_eq!(config.remote.reasoning_effort, "medium");
        assert_eq!(config.ollama.context_window_tokens, 16_384);
        assert_eq!(config.resilience.max_retries, 2);
    }
}
