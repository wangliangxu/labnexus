use super::types::KnowledgeEntry;
use sqlx::{sqlite::SqlitePoolOptions, Pool, Row, Sqlite};
use std::fs;
use std::path::PathBuf;

#[derive(Clone)]
pub struct KnowledgeStore {
    pool: Pool<Sqlite>,
}

impl KnowledgeStore {
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
            .map_err(|e| format!("Failed to connect to SQLite database: {}", e))?;

        // Create table if not exists
        sqlx::query(
            "CREATE TABLE IF NOT EXISTS knowledge_entries (
                id TEXT PRIMARY KEY,
                title TEXT NOT NULL,
                content TEXT NOT NULL,
                category TEXT NOT NULL,
                tags_json TEXT NOT NULL,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );",
        )
        .execute(&pool)
        .await
        .map_err(|e| format!("Failed to initialize knowledge_entries table: {}", e))?;

        let store = Self { pool };
        store.seed_defaults_if_empty().await?;

        Ok(store)
    }

    async fn seed_defaults_if_empty(&self) -> Result<(), String> {
        let count: i64 = sqlx::query("SELECT COUNT(*) as cnt FROM knowledge_entries")
            .fetch_one(&self.pool)
            .await
            .map(|row| row.get::<i64, _>("cnt"))
            .unwrap_or(0);

        if count == 0 {
            let now = chrono::Utc::now().to_rfc3339();
            let defaults = vec![
                KnowledgeEntry {
                    id: "kb-001".to_string(),
                    title: "Pandas Dataframe Memory Optimization".to_string(),
                    content: "When loading large CSV datasets in pandas, use `dtype` parameter or downcast numerical types (`pd.to_numeric(df[col], downcast='integer'|'float')`) and convert low-cardinality strings to `'category'` dtype to reduce memory consumption by up to 70%.".to_string(),
                    category: "Scientific Computing".to_string(),
                    tags: vec!["pandas".to_string(), "memory".to_string(), "dataframe".to_string(), "optimization".to_string(), "csv".to_string()],
                    created_at: now.clone(),
                    updated_at: now.clone(),
                },
                KnowledgeEntry {
                    id: "kb-002".to_string(),
                    title: "Jupyter Kernel Execution Environment Rules".to_string(),
                    content: "In remote JupyterLab kernels, never run interactive GUI plot commands like `plt.show(block=True)` or `cv2.imshow()`, as they will freeze or crash the headless remote kernel. Always use inline matplotlib backend `%matplotlib inline` or save figures to files.".to_string(),
                    category: "Jupyter Rules".to_string(),
                    tags: vec!["matplotlib".to_string(), "plot".to_string(), "kernel".to_string(), "gui".to_string(), "inline".to_string(), "remote".to_string()],
                    created_at: now.clone(),
                    updated_at: now.clone(),
                },
                KnowledgeEntry {
                    id: "kb-003".to_string(),
                    title: "PyTorch & GPU Memory Cleanup in Notebooks".to_string(),
                    content: "In Jupyter notebooks, PyTorch tensors remain in GPU memory even after cell execution if referenced in the global namespace. To free GPU memory without restarting the kernel, use `del tensor_var; import gc; gc.collect(); torch.cuda.empty_cache()`.".to_string(),
                    category: "Scientific Computing".to_string(),
                    tags: vec!["pytorch".to_string(), "gpu".to_string(), "cuda".to_string(), "memory".to_string(), "cleanup".to_string(), "tensor".to_string()],
                    created_at: now.clone(),
                    updated_at: now.clone(),
                },
            ];

            for entry in defaults {
                let _ = self.save_entry(&entry).await;
            }
        }
        Ok(())
    }

    pub async fn list_entries(&self) -> Result<Vec<KnowledgeEntry>, String> {
        let rows = sqlx::query("SELECT id, title, content, category, tags_json, created_at, updated_at FROM knowledge_entries ORDER BY updated_at DESC")
            .fetch_all(&self.pool)
            .await
            .map_err(|e| format!("Failed to list knowledge entries: {}", e))?;

        let mut entries = Vec::new();
        for row in rows {
            let tags_json: String = row.get("tags_json");
            let tags: Vec<String> = serde_json::from_str(&tags_json).unwrap_or_default();
            entries.push(KnowledgeEntry {
                id: row.get("id"),
                title: row.get("title"),
                content: row.get("content"),
                category: row.get("category"),
                tags,
                created_at: row.get("created_at"),
                updated_at: row.get("updated_at"),
            });
        }
        Ok(entries)
    }

    pub async fn save_entry(&self, entry: &KnowledgeEntry) -> Result<(), String> {
        let tags_json = serde_json::to_string(&entry.tags).unwrap_or_else(|_| "[]".to_string());
        sqlx::query(
            "INSERT OR REPLACE INTO knowledge_entries (id, title, content, category, tags_json, created_at, updated_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7)"
        )
        .bind(&entry.id)
        .bind(&entry.title)
        .bind(&entry.content)
        .bind(&entry.category)
        .bind(&tags_json)
        .bind(&entry.created_at)
        .bind(&entry.updated_at)
        .execute(&self.pool)
        .await
        .map_err(|e| format!("Failed to save knowledge entry: {}", e))?;

        Ok(())
    }

    pub async fn delete_entry(&self, id: &str) -> Result<(), String> {
        sqlx::query("DELETE FROM knowledge_entries WHERE id = $1")
            .bind(id)
            .execute(&self.pool)
            .await
            .map_err(|e| format!("Failed to delete knowledge entry: {}", e))?;
        Ok(())
    }
}
