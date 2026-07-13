use crate::agent::{AgentChatContext, AgentMessage};
use serde::{Deserialize, Serialize};
use sqlx::{sqlite::SqlitePoolOptions, Pool, Row, Sqlite};
use std::fs;
use std::path::PathBuf;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PersistedAgentSession {
    pub session_id: String,
    pub title: String,
    pub history: Vec<AgentMessage>,
    pub context: AgentChatContext,
    pub summary: String,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AgentSessionListItem {
    pub session_id: String,
    pub title: String,
    pub updated_at: String,
    pub message_count: usize,
    pub notebook_path: Option<String>,
}

#[derive(Clone)]
pub struct AgentSessionStore {
    pool: Pool<Sqlite>,
}

impl AgentSessionStore {
    pub async fn init() -> Result<Self, String> {
        let home_dir = std::env::var("HOME")
            .or_else(|_| std::env::var("USERPROFILE"))
            .unwrap_or_else(|_| ".".to_string());
        let config_dir = PathBuf::from(home_dir).join(".labnexus");
        fs::create_dir_all(&config_dir)
            .map_err(|error| format!("Failed to create LabNexus data directory: {}", error))?;
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            fs::set_permissions(&config_dir, fs::Permissions::from_mode(0o700))
                .map_err(|error| format!("Failed to secure LabNexus data directory: {}", error))?;
        }
        let db_path = config_dir.join("data.db");
        let store = Self::init_at(db_path.clone()).await?;
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            fs::set_permissions(&db_path, fs::Permissions::from_mode(0o600))
                .map_err(|error| format!("Failed to secure Agent database: {}", error))?;
        }
        Ok(store)
    }

    async fn init_at(db_path: PathBuf) -> Result<Self, String> {
        let db_url = format!("sqlite://{}?mode=rwc", db_path.to_string_lossy());
        let pool = SqlitePoolOptions::new()
            .max_connections(5)
            .connect(&db_url)
            .await
            .map_err(|error| format!("Failed to connect to Agent session database: {}", error))?;

        sqlx::query(
            "CREATE TABLE IF NOT EXISTS agent_sessions (
                session_id TEXT PRIMARY KEY,
                title TEXT NOT NULL DEFAULT 'New Chat',
                history_json TEXT NOT NULL,
                context_json TEXT NOT NULL,
                summary TEXT NOT NULL DEFAULT '',
                created_at TEXT NOT NULL DEFAULT '',
                updated_at TEXT NOT NULL
            );",
        )
        .execute(&pool)
        .await
        .map_err(|error| format!("Failed to initialize agent_sessions table: {}", error))?;

        for migration in [
            "ALTER TABLE agent_sessions ADD COLUMN title TEXT NOT NULL DEFAULT 'New Chat'",
            "ALTER TABLE agent_sessions ADD COLUMN summary TEXT NOT NULL DEFAULT ''",
            "ALTER TABLE agent_sessions ADD COLUMN created_at TEXT NOT NULL DEFAULT ''",
        ] {
            let _ = sqlx::query(migration).execute(&pool).await;
        }

        Ok(Self { pool })
    }

    pub async fn load(&self, session_id: &str) -> Result<Option<PersistedAgentSession>, String> {
        let row = sqlx::query(
            "SELECT session_id, title, history_json, context_json, summary, created_at, updated_at
             FROM agent_sessions WHERE session_id = $1",
        )
        .bind(session_id)
        .fetch_optional(&self.pool)
        .await
        .map_err(|error| format!("Failed to load Agent session: {}", error))?;

        row.map(|row| {
            let history_json: String = row.get("history_json");
            let context_json: String = row.get("context_json");
            Ok(PersistedAgentSession {
                session_id: row.get("session_id"),
                title: row.get("title"),
                history: serde_json::from_str(&history_json)
                    .map_err(|error| format!("Invalid persisted Agent history: {}", error))?,
                context: serde_json::from_str(&context_json)
                    .map_err(|error| format!("Invalid persisted Agent context: {}", error))?,
                summary: row.get("summary"),
                created_at: row.get("created_at"),
                updated_at: row.get("updated_at"),
            })
        })
        .transpose()
    }

    pub async fn save(&self, session: &PersistedAgentSession) -> Result<(), String> {
        let history_json = serde_json::to_string(&session.history)
            .map_err(|error| format!("Failed to serialize Agent history: {}", error))?;
        let context_json = serde_json::to_string(&session.context)
            .map_err(|error| format!("Failed to serialize Agent context: {}", error))?;
        sqlx::query(
            "INSERT INTO agent_sessions (session_id, title, history_json, context_json, summary, created_at, updated_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7)
             ON CONFLICT(session_id) DO UPDATE SET
               title = excluded.title,
               history_json = excluded.history_json,
               context_json = excluded.context_json,
               summary = excluded.summary,
               created_at = CASE
                 WHEN agent_sessions.created_at = '' THEN excluded.created_at
                 ELSE agent_sessions.created_at
               END,
               updated_at = excluded.updated_at",
        )
        .bind(&session.session_id)
        .bind(&session.title)
        .bind(history_json)
        .bind(context_json)
        .bind(&session.summary)
        .bind(&session.created_at)
        .bind(&session.updated_at)
        .execute(&self.pool)
        .await
        .map_err(|error| format!("Failed to save Agent session: {}", error))?;
        Ok(())
    }

    pub async fn delete(&self, session_id: &str) -> Result<(), String> {
        sqlx::query("DELETE FROM agent_sessions WHERE session_id = $1")
            .bind(session_id)
            .execute(&self.pool)
            .await
            .map_err(|error| format!("Failed to delete Agent session: {}", error))?;
        Ok(())
    }

    pub async fn list(&self, limit: usize) -> Result<Vec<AgentSessionListItem>, String> {
        let rows = sqlx::query(
            "SELECT session_id, title, history_json, context_json, updated_at
             FROM agent_sessions ORDER BY updated_at DESC LIMIT $1",
        )
        .bind(limit.clamp(1, 200) as i64)
        .fetch_all(&self.pool)
        .await
        .map_err(|error| format!("Failed to list Agent sessions: {}", error))?;
        rows.into_iter()
            .map(|row| {
                let history_json: String = row.get("history_json");
                let context_json: String = row.get("context_json");
                let history: Vec<AgentMessage> = serde_json::from_str(&history_json)
                    .map_err(|error| format!("Invalid persisted Agent history: {}", error))?;
                let context: AgentChatContext = serde_json::from_str(&context_json)
                    .map_err(|error| format!("Invalid persisted Agent context: {}", error))?;
                Ok(AgentSessionListItem {
                    session_id: row.get("session_id"),
                    title: row.get("title"),
                    updated_at: row.get("updated_at"),
                    message_count: history
                        .iter()
                        .filter(|message| message.role != "system")
                        .count(),
                    notebook_path: context.notebook_path,
                })
            })
            .collect()
    }

    pub async fn rename(&self, session_id: &str, title: &str) -> Result<(), String> {
        sqlx::query("UPDATE agent_sessions SET title = $1, updated_at = $2 WHERE session_id = $3")
            .bind(title)
            .bind(chrono::Utc::now().to_rfc3339())
            .bind(session_id)
            .execute(&self.pool)
            .await
            .map_err(|error| format!("Failed to rename Agent session: {}", error))?;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::{AgentSessionStore, PersistedAgentSession};
    use crate::agent::{AgentChatContext, AgentMessage};

    #[tokio::test]
    async fn persists_loads_and_deletes_session() {
        let path = std::env::temp_dir().join(format!(
            "labnexus-agent-session-{}.db",
            uuid::Uuid::new_v4()
        ));
        let store = AgentSessionStore::init_at(path.clone())
            .await
            .expect("initialize store");
        let session = PersistedAgentSession {
            session_id: "test-session".to_string(),
            title: "Test Session".to_string(),
            history: vec![AgentMessage::user("hello")],
            context: AgentChatContext::default(),
            summary: "summary".to_string(),
            created_at: chrono::Utc::now().to_rfc3339(),
            updated_at: chrono::Utc::now().to_rfc3339(),
        };
        store.save(&session).await.expect("save session");
        let loaded = store
            .load("test-session")
            .await
            .expect("load session")
            .expect("stored session");
        assert_eq!(loaded.history.len(), 1);
        assert_eq!(loaded.history[0].content, "hello");
        assert_eq!(loaded.title, "Test Session");
        let listed = store.list(10).await.expect("list sessions");
        assert_eq!(listed[0].message_count, 1);
        store
            .rename("test-session", "Renamed")
            .await
            .expect("rename session");
        assert_eq!(
            store.load("test-session").await.unwrap().unwrap().title,
            "Renamed"
        );
        store.delete("test-session").await.expect("delete session");
        assert!(store.load("test-session").await.expect("reload").is_none());
        drop(store);
        let _ = std::fs::remove_file(path);
    }
}
