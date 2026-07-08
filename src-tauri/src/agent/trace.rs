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
            );",
        )
        .execute(&pool)
        .await
        .map_err(|e| format!("Failed to initialize agent_traces table: {}", e))?;

        Ok(Self { pool })
    }

    pub async fn list_traces(&self, limit: usize) -> Result<Vec<AgentTrace>, String> {
        let query_str = format!(
            "SELECT id, task_prompt, status, start_time, end_time, total_duration_ms, steps_json, matched_skill, used_knowledge_json 
             FROM agent_traces ORDER BY start_time DESC LIMIT {}",
            limit
        );
        let rows = sqlx::query(&query_str)
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
            });
        }
        Ok(traces)
    }

    pub async fn save_trace(&self, trace: &AgentTrace) -> Result<(), String> {
        let steps_json = serde_json::to_string(&trace.steps).unwrap_or_else(|_| "[]".to_string());
        let used_k_json =
            serde_json::to_string(&trace.used_knowledge_ids).unwrap_or_else(|_| "[]".to_string());

        sqlx::query(
            "INSERT OR REPLACE INTO agent_traces (id, task_prompt, status, start_time, end_time, total_duration_ms, steps_json, matched_skill, used_knowledge_json)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)"
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
        .execute(&self.pool)
        .await
        .map_err(|e| format!("Failed to save trace: {}", e))?;

        Ok(())
    }
}
