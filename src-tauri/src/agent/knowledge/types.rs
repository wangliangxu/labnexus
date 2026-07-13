use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct KnowledgeEntry {
    pub id: String,
    pub title: String,
    pub content: String,
    pub category: String,
    pub tags: Vec<String>,
    #[serde(default = "default_source")]
    pub source: String,
    #[serde(default = "default_trust_level")]
    pub trust_level: String,
    #[serde(default = "default_enabled")]
    pub enabled: bool,
    pub created_at: String,
    pub updated_at: String,
}

fn default_source() -> String {
    "user".to_string()
}

fn default_trust_level() -> String {
    "unverified".to_string()
}

fn default_enabled() -> bool {
    true
}
