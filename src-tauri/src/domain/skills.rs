//! Markdown-based Skills Module for Anonymed Copilot
//!
//! This module loads skills from SKILL.md files with YAML frontmatter,
//! similar to Claude Code / GitHub Copilot Agent Skills.

use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;
use std::sync::OnceLock;

/// Skill metadata from YAML frontmatter
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SkillMetadata {
    pub name: String,
    pub description: String,
    pub keywords: Vec<String>,
}

/// A loaded skill with metadata and instructions
#[derive(Debug, Clone, Serialize)]
pub struct LoadedSkill {
    pub metadata: SkillMetadata,
    pub instructions: String,
}

// Global cache for loaded skills
static SKILLS_CACHE: OnceLock<Vec<LoadedSkill>> = OnceLock::new();

/// Get the skills directory path relative to the executable
fn get_skills_dir() -> PathBuf {
    // In development, skills are in src-tauri/skills
    // In production, they will be bundled as resources
    let exe_path = std::env::current_exe().unwrap_or_default();
    let exe_dir = exe_path.parent().unwrap_or(std::path::Path::new("."));

    // Get current working directory for development mode
    let cwd = std::env::current_dir().unwrap_or_default();

    // Try multiple possible locations
    let candidates = [
        // Development: CWD is project root (Anonymed-Copilot)
        cwd.join("src-tauri/skills"),
        // Development: CWD might be src-tauri
        cwd.join("skills"),
        // Development: relative paths
        PathBuf::from("src-tauri/skills"),
        PathBuf::from("skills"),
        // Production: bundled resources (macOS)
        exe_dir.join("../Resources/skills"),
        // Production: bundled resources (Linux/Windows)
        exe_dir.join("skills"),
    ];

    for path in &candidates {
        if path.exists() && path.is_dir() {
            println!("[Skills] Found skills directory at: {:?}", path);
            return path.clone();
        }
    }

    // Log all attempted paths for debugging
    eprintln!("[Skills] Could not find skills directory. Tried:");
    for path in &candidates {
        eprintln!("  - {:?} (exists: {})", path, path.exists());
    }

    // Fallback
    PathBuf::from("skills")
}

/// Parse a SKILL.md file into metadata and instructions
fn parse_skill_file(content: &str) -> Result<(SkillMetadata, String), String> {
    // YAML frontmatter is between --- and ---
    if !content.starts_with("---") {
        return Err("SKILL.md must start with YAML frontmatter (---)".to_string());
    }

    let parts: Vec<&str> = content.splitn(3, "---").collect();
    if parts.len() < 3 {
        return Err("Invalid SKILL.md format: missing closing ---".to_string());
    }

    let yaml_content = parts[1].trim();
    let markdown_content = parts[2].trim();

    let metadata: SkillMetadata = serde_yaml::from_str(yaml_content)
        .map_err(|e| format!("Failed to parse YAML frontmatter: {}", e))?;

    Ok((metadata, markdown_content.to_string()))
}

/// Load a single skill from a directory
fn load_skill_from_dir(skill_dir: &PathBuf) -> Result<LoadedSkill, String> {
    let skill_file = skill_dir.join("SKILL.md");

    if !skill_file.exists() {
        return Err(format!("SKILL.md not found in {:?}", skill_dir));
    }

    let content = fs::read_to_string(&skill_file)
        .map_err(|e| format!("Failed to read {:?}: {}", skill_file, e))?;

    let (metadata, instructions) = parse_skill_file(&content)?;

    Ok(LoadedSkill {
        metadata,
        instructions,
    })
}

/// Load all skills from the skills directory
pub fn load_all_skills() -> Vec<LoadedSkill> {
    let skills_dir = get_skills_dir();

    if !skills_dir.exists() {
        eprintln!("Skills directory not found: {:?}", skills_dir);
        return vec![];
    }

    let mut skills = Vec::new();

    if let Ok(entries) = fs::read_dir(&skills_dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_dir() {
                match load_skill_from_dir(&path) {
                    Ok(skill) => {
                        println!("Loaded skill: {}", skill.metadata.name);
                        skills.push(skill);
                    }
                    Err(e) => {
                        eprintln!("Failed to load skill from {:?}: {}", path, e);
                    }
                }
            }
        }
    }

    skills
}

/// Get all loaded skills (with caching)
pub fn get_skills() -> &'static Vec<LoadedSkill> {
    SKILLS_CACHE.get_or_init(load_all_skills)
}

/// Find skills that match the given user input based on keyword matching
pub fn find_matching_skills(user_input: &str) -> Vec<&'static LoadedSkill> {
    let lower_input = user_input.to_lowercase();
    let skills = get_skills();

    let mut matches: Vec<(&LoadedSkill, usize)> = skills
        .iter()
        .filter_map(|skill| {
            let match_count = skill.metadata.keywords.iter()
                .filter(|kw| lower_input.contains(&kw.to_lowercase()))
                .count();

            if match_count > 0 {
                Some((skill, match_count))
            } else {
                None
            }
        })
        .collect();

    // Sort by match count (descending)
    matches.sort_by(|a, b| b.1.cmp(&a.1));

    // Return only the skills (without scores), limited to top 2
    matches.into_iter()
        .take(2)
        .map(|(skill, _)| skill)
        .collect()
}

/// Build an enhanced prompt with skill context
pub fn build_prompt_with_skills(base_prompt: &str, skills: &[&LoadedSkill]) -> String {
    if skills.is_empty() {
        return base_prompt.to_string();
    }

    let mut prompt = base_prompt.to_string();
    prompt.push_str("\n\n## 適用されるドメイン知識（スキル）\n");
    prompt.push_str("以下のドメイン固有の匿名化ルールを適用してください：\n");

    for skill in skills {
        prompt.push_str(&format!(
            "\n### {} ({})\n{}\n",
            skill.metadata.name,
            skill.metadata.description,
            skill.instructions
        ));
    }

    prompt
}

/// Get skill names from a list of skills
pub fn get_skill_names(skills: &[&LoadedSkill]) -> Vec<String> {
    skills.iter().map(|s| s.metadata.name.clone()).collect()
}

/// Generate a policy summary based on matched skills
/// Extracts key rules from the skill's instruction markdown (table rows)
pub fn get_skill_policy_summary(skills: &[&LoadedSkill]) -> Vec<String> {
    let mut summary = Vec::new();

    for skill in skills {
        // Extract transformation rules from markdown tables
        for line in skill.instructions.lines() {
            let trimmed = line.trim();
            // Skip non-table lines
            if !trimmed.starts_with('|') {
                continue;
            }
            // Skip header row (contains "カテゴリ" or "処理方法")
            if trimmed.contains("カテゴリ") || trimmed.contains("処理方法") {
                continue;
            }
            // Skip separator row (contains only |, -, :)
            if trimmed.chars().all(|c| c == '|' || c == '-' || c == ':' || c.is_whitespace()) {
                continue;
            }

            // Parse table row: | Category | Method | Example |
            let parts: Vec<&str> = trimmed.split('|').filter(|s| !s.is_empty()).collect();
            if parts.len() >= 2 {
                let category = parts[0].trim();
                let method = parts[1].trim();
                if !category.is_empty() && !method.is_empty() {
                    summary.push(format!("{} → {}", category, method));
                }
            }
        }
    }

    // Limit to 5 items
    summary.truncate(5);
    summary
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_skill_file() {
        let content = r#"---
name: test-skill
description: A test skill
keywords:
  - test
  - sample
---

# Test Skill

This is the instruction content.
"#;
        let result = parse_skill_file(content);
        assert!(result.is_ok());

        let (metadata, instructions) = result.unwrap();
        assert_eq!(metadata.name, "test-skill");
        assert_eq!(metadata.description, "A test skill");
        assert_eq!(metadata.keywords, vec!["test", "sample"]);
        assert!(instructions.contains("# Test Skill"));
    }

    #[test]
    fn test_parse_invalid_skill_file() {
        let content = "No frontmatter here";
        let result = parse_skill_file(content);
        assert!(result.is_err());
    }
}
