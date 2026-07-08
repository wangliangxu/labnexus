use super::store::KnowledgeStore;
use super::types::KnowledgeEntry;

pub struct KnowledgeRetrieval {
    store: KnowledgeStore,
}

impl KnowledgeRetrieval {
    pub fn new(store: KnowledgeStore) -> Self {
        Self { store }
    }

    pub async fn retrieve(&self, query: &str) -> Result<Vec<KnowledgeEntry>, String> {
        let entries = self.store.list_entries().await?;
        let query_lower = query.to_lowercase();
        let query_words: Vec<&str> = query_lower.split_whitespace().collect();

        let mut scored_entries: Vec<(usize, KnowledgeEntry)> = Vec::new();

        for entry in entries {
            let mut score = 0;
            let title_lower = entry.title.to_lowercase();
            let content_lower = entry.content.to_lowercase();
            let cat_lower = entry.category.to_lowercase();

            // Check exact keyword matches
            for word in &query_words {
                if word.len() < 2 {
                    continue;
                }
                if title_lower.contains(word) {
                    score += 5;
                }
                if cat_lower.contains(word) {
                    score += 3;
                }
                if content_lower.contains(word) {
                    score += 2;
                }
                for tag in &entry.tags {
                    if tag.to_lowercase() == *word || tag.to_lowercase().contains(word) {
                        score += 6;
                    }
                }
            }

            if score > 0 {
                scored_entries.push((score, entry));
            }
        }

        // Sort by score descending
        scored_entries.sort_by(|a, b| b.0.cmp(&a.0));

        // Return top 3
        let top_entries = scored_entries.into_iter().take(3).map(|(_, e)| e).collect();
        Ok(top_entries)
    }

    pub fn format_knowledge_prompt(&self, entries: &[KnowledgeEntry]) -> String {
        if entries.is_empty() {
            return String::new();
        }

        let mut prompt = String::from("### Relevant Domain Knowledge & Rules:\n<knowledge>\n");
        for entry in entries {
            prompt.push_str(&format!(
                "- **{}** [Category: {} | Tags: {}]: {}\n",
                entry.title,
                entry.category,
                entry.tags.join(", "),
                entry.content
            ));
        }
        prompt.push_str("</knowledge>\n");
        prompt
    }
}
