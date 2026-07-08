//! LabNexus — AI Provider configuration management.
//!
//! Stores and loads configuration from `~/.labnexus/config/ai.json`.
//! Supports Hybrid LLM strategy: Remote API (OpenAI / DeepSeek) & Local Ollama / llama.cpp.

use crate::error::AppError;
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;

/// Top-level AI configuration.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AiConfig {
    /// Active provider: "remote" | "ollama"
    pub provider: String,
    pub remote: RemoteApiConfig,
    pub ollama: OllamaConfig,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RemoteApiConfig {
    pub enabled: bool,
    pub api_key: String,
    pub base_url: String, // e.g. "https://api.deepseek.com" or "https://api.openai.com/v1"
    pub chat_model: String, // e.g. "deepseek-chat" or "gpt-4o"
    pub reasoning_model: String, // e.g. "deepseek-reasoner"
    pub temperature: f32,
    pub top_p: f32,
    pub timeout_seconds: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OllamaConfig {
    pub enabled: bool,
    pub base_url: String,   // e.g. "http://127.0.0.1:11434"
    pub chat_model: String, // e.g. "qwen2.5-coder:7b"
    pub temperature: f32,
    pub top_p: f32,
    pub timeout_seconds: u64,
}

impl Default for AiConfig {
    fn default() -> Self {
        Self {
            provider: "remote".to_string(),
            remote: RemoteApiConfig::default(),
            ollama: OllamaConfig::default(),
        }
    }
}

impl Default for RemoteApiConfig {
    fn default() -> Self {
        Self {
            enabled: true,
            api_key: "".to_string(),
            base_url: "https://api.deepseek.com".to_string(),
            chat_model: "deepseek-chat".to_string(),
            reasoning_model: "deepseek-reasoner".to_string(),
            temperature: 0.2,
            top_p: 0.9,
            timeout_seconds: 60,
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
        }
    }
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
    if !path.exists() {
        return AiConfig::default();
    }
    match fs::read_to_string(&path) {
        Ok(content) => match serde_json::from_str(&content) {
            Ok(config) => config,
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
}

/// Save AI configuration to disk.
pub fn save_ai_config(config: &AiConfig) -> Result<(), AppError> {
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
    fs::write(&path, content)
        .map_err(|e| AppError::Agent(format!("Failed to write AI config to {:?}: {}", path, e)))?;
    Ok(())
}
