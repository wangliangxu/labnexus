use serde::{Deserialize, Serialize};
use sqlx::{sqlite::SqlitePoolOptions, Pool, Row, Sqlite};
use std::fs;
use std::path::PathBuf;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TraceStep {
    pub step_number: usize,
    pub step_type: String,
    pub content: String,
    pub tool_name: Option<String>,
    pub duration_ms: u64,
    pub timestamp: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AgentTrace {
    pub id: String,
    pub task_prompt: String,
    pub status: String,
    pub start_time: String,
    pub end_time: Option<String>,
    pub total_duration_ms: u64,
    pub steps: Vec<TraceStep>,
    pub matched_skill: Option<String>,
    pub used_knowledge_ids: Vec<String>,
    #[serde(default)]
    pub provider: String,
    #[serde(default)]
    pub model: String,
    #[serde(default)]
    pub prompt_tokens: u64,
    #[serde(default)]
    pub completion_tokens: u64,
    #[serde(default)]
    pub reasoning_chars: u64,
}

#[derive(Clone)]
pub struct TraceStore {
    pool: Pool<Sqlite>,
}

impl TraceStore {
    pub async fn init() -> Result<Self, String> {
        let home_dir = std::env::var("HOME")
            .or_else(|_| std::env::var("USERPROFILE"))
            .unwrap_or_else(|_| ".".to_string());

        let config_dir = PathBuf::from(home_dir).join(".labnexus");
        if !config_dir.exists() {
            let _ = fs::create_dir_all(&config_dir);
        }

        let db_path = config_dir.join("data.db");
        Self::init_at(db_path).await
    }

    async fn init_at(db_path: PathBuf) -> Result<Self, String> {
        let db_url = format!("sqlite://{}?mode=rwc", db_path.to_string_lossy());

        let pool = SqlitePoolOptions::new()
            .max_connections(5)
            .connect(&db_url)
            .await
            .map_err(|e| format!("Failed to connect to SQLite database for trace: {}", e))?;

        sqlx::query(
            "CREATE TABLE IF NOT EXISTS agent_traces (
                id TEXT PRIMARY KEY,
                task_prompt TEXT NOT NULL,
                status TEXT NOT NULL,
                start_time TEXT NOT NULL,
                end_time TEXT,
                total_duration_ms INTEGER NOT NULL,
                steps_json TEXT NOT NULL,
                matched_skill TEXT,
                used_knowledge_json TEXT NOT NULL
                , provider TEXT NOT NULL DEFAULT ''
                , model TEXT NOT NULL DEFAULT ''
                , prompt_tokens INTEGER NOT NULL DEFAULT 0
                , completion_tokens INTEGER NOT NULL DEFAULT 0
                , reasoning_chars INTEGER NOT NULL DEFAULT 0
            );",
        )
        .execute(&pool)
        .await
        .map_err(|e| format!("Failed to initialize agent_traces table: {}", e))?;

        for migration in [
            "ALTER TABLE agent_traces ADD COLUMN provider TEXT NOT NULL DEFAULT ''",
            "ALTER TABLE agent_traces ADD COLUMN model TEXT NOT NULL DEFAULT ''",
            "ALTER TABLE agent_traces ADD COLUMN prompt_tokens INTEGER NOT NULL DEFAULT 0",
            "ALTER TABLE agent_traces ADD COLUMN completion_tokens INTEGER NOT NULL DEFAULT 0",
            "ALTER TABLE agent_traces ADD COLUMN reasoning_chars INTEGER NOT NULL DEFAULT 0",
        ] {
            let _ = sqlx::query(migration).execute(&pool).await;
        }

        Ok(Self { pool })
    }

    pub async fn list_traces(&self, limit: usize) -> Result<Vec<AgentTrace>, String> {
        let rows = sqlx::query(
            "SELECT id, task_prompt, status, start_time, end_time, total_duration_ms, steps_json, matched_skill, used_knowledge_json, provider, model, prompt_tokens, completion_tokens, reasoning_chars
             FROM agent_traces ORDER BY start_time DESC LIMIT $1",
        )
            .bind(limit.clamp(1, 200) as i64)
            .fetch_all(&self.pool)
            .await
            .map_err(|e| format!("Failed to list traces: {}", e))?;

        let mut traces = Vec::new();
        for row in rows {
            let steps_json: String = row.get("steps_json");
            let steps: Vec<TraceStep> = serde_json::from_str(&steps_json).unwrap_or_default();
            let used_k_json: String = row.get("used_knowledge_json");
            let used_knowledge_ids: Vec<String> =
                serde_json::from_str(&used_k_json).unwrap_or_default();

            traces.push(AgentTrace {
                id: row.get("id"),
                task_prompt: row.get("task_prompt"),
                status: row.get("status"),
                start_time: row.get("start_time"),
                end_time: row.get("end_time"),
                total_duration_ms: row.get("total_duration_ms"),
                steps,
                matched_skill: row.get("matched_skill"),
                used_knowledge_ids,
                provider: row.get("provider"),
                model: row.get("model"),
                prompt_tokens: row.get::<i64, _>("prompt_tokens") as u64,
                completion_tokens: row.get::<i64, _>("completion_tokens") as u64,
                reasoning_chars: row.get::<i64, _>("reasoning_chars") as u64,
            });
        }
        Ok(traces)
    }

    pub async fn save_trace(&self, trace: &AgentTrace) -> Result<(), String> {
        let steps_json = serde_json::to_string(&trace.steps).unwrap_or_else(|_| "[]".to_string());
        let used_k_json =
            serde_json::to_string(&trace.used_knowledge_ids).unwrap_or_else(|_| "[]".to_string());

        sqlx::query(
            "INSERT OR REPLACE INTO agent_traces (id, task_prompt, status, start_time, end_time, total_duration_ms, steps_json, matched_skill, used_knowledge_json, provider, model, prompt_tokens, completion_tokens, reasoning_chars)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)"
        )
        .bind(&trace.id)
        .bind(&trace.task_prompt)
        .bind(&trace.status)
        .bind(&trace.start_time)
        .bind(&trace.end_time)
        .bind(trace.total_duration_ms as i64)
        .bind(&steps_json)
        .bind(&trace.matched_skill)
        .bind(&used_k_json)
        .bind(&trace.provider)
        .bind(&trace.model)
        .bind(trace.prompt_tokens as i64)
        .bind(trace.completion_tokens as i64)
        .bind(trace.reasoning_chars as i64)
        .execute(&self.pool)
        .await
        .map_err(|e| format!("Failed to save trace: {}", e))?;

        // Bound local audit storage while preserving the newest traces.
        sqlx::query(
            "DELETE FROM agent_traces WHERE id NOT IN (
                SELECT id FROM agent_traces ORDER BY start_time DESC LIMIT 500
            )",
        )
        .execute(&self.pool)
        .await
        .map_err(|e| format!("Failed to enforce Agent trace retention: {}", e))?;

        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::{AgentTrace, TraceStore};

    #[tokio::test]
    async fn persists_provider_usage_metadata() {
        let path =
            std::env::temp_dir().join(format!("labnexus-agent-trace-{}.db", uuid::Uuid::new_v4()));
        let store = TraceStore::init_at(path.clone())
            .await
            .expect("trace store");
        let trace = AgentTrace {
            id: "run-1".to_string(),
            task_prompt: "test".to_string(),
            status: "Completed".to_string(),
            start_time: chrono::Utc::now().to_rfc3339(),
            end_time: Some(chrono::Utc::now().to_rfc3339()),
            total_duration_ms: 10,
            steps: Vec::new(),
            matched_skill: None,
            used_knowledge_ids: Vec::new(),
            provider: "ollama".to_string(),
            model: "qwen".to_string(),
            prompt_tokens: 12,
            completion_tokens: 4,
            reasoning_chars: 20,
        };
        store.save_trace(&trace).await.expect("save trace");
        let loaded = store.list_traces(10).await.expect("list traces");
        assert_eq!(loaded[0].provider, "ollama");
        assert_eq!(loaded[0].prompt_tokens, 12);
        drop(store);
        let _ = std::fs::remove_file(path);
    }
}
