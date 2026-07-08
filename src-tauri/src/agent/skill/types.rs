use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SkillParameter {
    pub name: String,
    pub description: String,
    pub required: bool,
    pub default_value: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SkillStep {
    pub step_number: usize,
    pub title: String,
    pub description: String,
    pub suggested_tool: Option<String>,
    pub suggested_code: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Skill {
    pub id: String,
    pub name: String,
    pub description: String,
    pub trigger_keywords: Vec<String>,
    pub parameters: Vec<SkillParameter>,
    pub steps: Vec<SkillStep>,
    pub system_prompt_addon: String,
}
