use super::store::KnowledgeStore;
use super::types::KnowledgeEntry;
use std::cmp::Ordering;
use std::collections::{HashMap, HashSet};

pub struct KnowledgeRetrieval {
    store: KnowledgeStore,
}

impl KnowledgeRetrieval {
    pub fn new(store: KnowledgeStore) -> Self {
        Self { store }
    }

    pub async fn retrieve(&self, query: &str) -> Result<Vec<KnowledgeEntry>, String> {
        let entries: Vec<_> = self
            .store
            .list_entries()
            .await?
            .into_iter()
            .filter(|entry| entry.enabled)
            .collect();
        Ok(rank_entries(query, entries, 3))
    }

    pub fn format_knowledge_prompt(&self, entries: &[KnowledgeEntry]) -> String {
        if entries.is_empty() {
            return String::new();
        }

        let mut prompt = String::from("### Relevant Domain Knowledge & Rules:\n<knowledge>\n");
        for entry in entries {
            prompt.push_str(&format!(
                "- **{}** [Category: {} | Source: {} | Trust: {} | Tags: {}]: {}\n",
                entry.title,
                entry.category,
                entry.source,
                entry.trust_level,
                entry.tags.join(", "),
                truncate_entry(&entry.content, 8_000)
            ));
        }
        prompt.push_str("</knowledge>\n");
        prompt
    }
}

fn rank_entries(query: &str, entries: Vec<KnowledgeEntry>, limit: usize) -> Vec<KnowledgeEntry> {
    let query_lower = query.to_lowercase();
    let query_tokens = tokenize(&query_lower);
    if query_tokens.is_empty() {
        return Vec::new();
    }

    let document_tokens: Vec<HashSet<String>> = entries
        .iter()
        .map(|entry| {
            tokenize(&format!(
                "{} {} {} {}",
                entry.title,
                entry.category,
                entry.tags.join(" "),
                entry.content
            ))
            .into_iter()
            .collect()
        })
        .collect();
    let mut document_frequency = HashMap::<String, usize>::new();
    for token in &query_tokens {
        let count = document_tokens
            .iter()
            .filter(|tokens| tokens.contains(token))
            .count();
        document_frequency.insert(token.clone(), count);
    }

    let document_count = entries.len() as f64;
    let mut scored = entries
        .into_iter()
        .zip(document_tokens)
        .filter_map(|(entry, all_tokens)| {
            let title = entry.title.to_lowercase();
            let category = entry.category.to_lowercase();
            let content = entry.content.to_lowercase();
            let tags: Vec<String> = entry.tags.iter().map(|tag| tag.to_lowercase()).collect();
            let mut score = 0.0;

            for token in &query_tokens {
                if !all_tokens.contains(token) {
                    continue;
                }
                let df = *document_frequency.get(token).unwrap_or(&0) as f64;
                let idf = ((document_count + 1.0) / (df + 1.0)).ln() + 1.0;
                if title.contains(token) {
                    score += 5.0 * idf;
                }
                if category.contains(token) {
                    score += 3.0 * idf;
                }
                if tags.iter().any(|tag| tag == token) {
                    score += 7.0 * idf;
                } else if tags.iter().any(|tag| tag.contains(token)) {
                    score += 4.0 * idf;
                }
                let occurrences = content.matches(token).count().min(3) as f64;
                score += occurrences * 1.5 * idf;
            }

            if query_lower.chars().count() >= 3
                && (title.contains(&query_lower) || content.contains(&query_lower))
            {
                score += 8.0;
            }
            score *= match entry.trust_level.as_str() {
                "verified" => 1.25,
                "reviewed" => 1.1,
                _ => 0.85,
            };

            (score > 0.0).then_some((score, entry))
        })
        .collect::<Vec<_>>();

    scored.sort_by(|left, right| right.0.partial_cmp(&left.0).unwrap_or(Ordering::Equal));
    let mut seen = HashSet::new();
    scored
        .into_iter()
        .filter_map(|(_, entry)| {
            let signature = format!(
                "{}\u{0}{}",
                entry.title.trim().to_lowercase(),
                entry.content.trim().to_lowercase()
            );
            seen.insert(signature).then_some(entry)
        })
        .take(limit)
        .collect()
}

fn tokenize(value: &str) -> Vec<String> {
    let mut tokens = HashSet::new();
    let mut word = String::new();
    let mut cjk_run = Vec::new();

    let flush_word = |word: &mut String, tokens: &mut HashSet<String>| {
        if word.chars().count() >= 2 {
            tokens.insert(std::mem::take(word));
        } else {
            word.clear();
        }
    };
    let flush_cjk = |run: &mut Vec<char>, tokens: &mut HashSet<String>| {
        for character in run.iter() {
            tokens.insert(character.to_string());
        }
        for pair in run.windows(2) {
            tokens.insert(pair.iter().collect());
        }
        run.clear();
    };

    for character in value.chars() {
        if is_cjk(character) {
            flush_word(&mut word, &mut tokens);
            cjk_run.push(character);
        } else {
            flush_cjk(&mut cjk_run, &mut tokens);
            if character.is_alphanumeric() || character == '_' || character == '-' {
                word.push(character.to_ascii_lowercase());
            } else {
                flush_word(&mut word, &mut tokens);
            }
        }
    }
    flush_word(&mut word, &mut tokens);
    flush_cjk(&mut cjk_run, &mut tokens);
    tokens.into_iter().collect()
}

fn is_cjk(character: char) -> bool {
    matches!(character as u32, 0x3400..=0x4DBF | 0x4E00..=0x9FFF | 0xF900..=0xFAFF)
}

fn truncate_entry(value: &str, max_chars: usize) -> String {
    if value.chars().count() <= max_chars {
        value.to_string()
    } else {
        format!(
            "{}\n...[knowledge entry truncated]",
            value.chars().take(max_chars).collect::<String>()
        )
    }
}

#[cfg(test)]
mod tests {
    use super::tokenize;

    #[test]
    fn tokenizes_english_and_chinese_queries() {
        let tokens = tokenize("Pandas 数据分析");
        assert!(tokens.contains(&"pandas".to_string()));
        assert!(tokens.contains(&"数据".to_string()));
        assert!(tokens.contains(&"分析".to_string()));
    }
}
