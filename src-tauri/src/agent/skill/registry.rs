use super::library::get_builtin_skills;
use super::types::Skill;

pub struct SkillRegistry {
    skills: Vec<Skill>,
}

impl SkillRegistry {
    pub fn new() -> Self {
        Self {
            skills: get_builtin_skills(),
        }
    }

    pub fn list_skills(&self) -> Vec<Skill> {
        self.skills.clone()
    }

    pub fn get_skill(&self, id: &str) -> Option<Skill> {
        self.skills.iter().find(|s| s.id == id).cloned()
    }

    pub fn match_query(&self, query: &str) -> Option<Skill> {
        let query_lower = query.trim().to_lowercase();

        // Check if explicit slash command like "/data-analysis" or "/notebook.data_analysis"
        if let Some(cmd) = query_lower.strip_prefix('/') {
            for skill in &self.skills {
                if skill.id.to_lowercase() == cmd
                    || skill.id.to_lowercase().ends_with(cmd)
                    || skill.name.to_lowercase().replace(' ', "-") == cmd
                {
                    return Some(skill.clone());
                }
            }
        }

        // Check trigger keywords
        for skill in &self.skills {
            for kw in &skill.trigger_keywords {
                if query_lower.contains(&kw.to_lowercase()) {
                    return Some(skill.clone());
                }
            }
        }

        None
    }

    pub fn format_skill_prompt(&self, skill: &Skill) -> String {
        let mut prompt = format!(
            "### Active Workflow Skill: {} ({})\n{}\n\n**Systematic Steps to Follow:**\n",
            skill.name, skill.id, skill.description
        );

        for step in &skill.steps {
            prompt.push_str(&format!(
                "{}. **{}**: {}\n",
                step.step_number, step.title, step.description
            ));
            if let Some(tool) = &step.suggested_tool {
                prompt.push_str(&format!("   - *Suggested Tool*: `{}`\n", tool));
            }
            if let Some(code) = &step.suggested_code {
                prompt.push_str(&format!(
                    "   - *Suggested Code*:\n```python\n{}\n```\n",
                    code
                ));
            }
        }

        if !skill.system_prompt_addon.is_empty() {
            prompt.push_str(&format!(
                "\n**Workflow Guidance**: {}\n",
                skill.system_prompt_addon
            ));
        }

        prompt
    }
}

impl Default for SkillRegistry {
    fn default() -> Self {
        Self::new()
    }
}
