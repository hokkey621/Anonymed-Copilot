use std::path::{Path, PathBuf};

pub fn sanitize_task_name(task_name: &str) -> String {
    let mut sanitized = String::with_capacity(task_name.len());
    for ch in task_name.chars() {
        if ch.is_ascii_alphanumeric() || ch == '-' || ch == '_' {
            sanitized.push(ch);
        } else if ch.is_whitespace() {
            sanitized.push('_');
        }
    }

    let trimmed = sanitized.trim_matches('_').to_string();
    if trimmed.is_empty() {
        "task".to_string()
    } else {
        trimmed
    }
}

#[derive(Clone, Debug)]
pub struct SimpleGitignore {
    rules: Vec<IgnoreRule>,
}

#[derive(Clone, Debug)]
struct IgnoreRule {
    pattern: String,
    negated: bool,
    directory_only: bool,
    has_slash: bool,
}

impl SimpleGitignore {
    pub fn from_file(base_dir: &Path) -> Result<Self, String> {
        let mut dirs = Vec::new();
        let mut current = Some(base_dir);
        while let Some(dir) = current {
            dirs.push(dir.to_path_buf());
            current = dir.parent();
        }
        dirs.reverse();

        let mut rules = Vec::new();
        for dir in dirs {
            let gitignore_path = dir.join(".gitignore");
            if !gitignore_path.exists() {
                continue;
            }

            let content = std::fs::read_to_string(&gitignore_path)
                .map_err(|e| format!("Failed to read .gitignore: {}", e))?;

            for line in content.lines() {
                let trimmed = line.trim();
                if trimmed.is_empty() || trimmed.starts_with('#') {
                    continue;
                }

                let mut pattern = trimmed.to_string();
                let mut negated = false;
                if let Some(rest) = trimmed.strip_prefix('!') {
                    negated = true;
                    pattern = rest.to_string();
                }

                let directory_only = pattern.ends_with('/');
                if directory_only {
                    pattern.pop();
                }

                if pattern.is_empty() {
                    continue;
                }

                let has_slash = pattern.contains('/');
                rules.push(IgnoreRule {
                    pattern,
                    negated,
                    directory_only,
                    has_slash,
                });
            }
        }

        Ok(Self { rules })
    }

    pub fn is_ignored(&self, base_dir: &Path, path: &Path) -> bool {
        let relative = match path.strip_prefix(base_dir) {
            Ok(rel) => rel,
            Err(_) => return false,
        };
        let relative_str = normalize_path(relative);
        let filename = relative
            .file_name()
            .and_then(|name| name.to_str())
            .unwrap_or_default();

        let mut ignored = false;
        for rule in &self.rules {
            let target = if rule.has_slash { &relative_str } else { filename };
            if matches_rule(rule, target, &relative_str) {
                ignored = !rule.negated;
            }
        }

        ignored
    }
}

fn normalize_path(path: &Path) -> String {
    path.components()
        .map(|c| c.as_os_str().to_string_lossy())
        .collect::<Vec<_>>()
        .join("/")
}

fn matches_rule(rule: &IgnoreRule, target: &str, relative_path: &str) -> bool {
    if rule.directory_only {
        if relative_path == rule.pattern {
            return true;
        }
        let prefix = format!("{}/", rule.pattern);
        return relative_path.starts_with(&prefix);
    }

    glob_match(&rule.pattern, target)
}

fn glob_match(pattern: &str, text: &str) -> bool {
    let mut p = 0;
    let mut t = 0;
    let mut star_idx: Option<usize> = None;
    let mut match_idx = 0;
    let pattern_bytes = pattern.as_bytes();
    let text_bytes = text.as_bytes();

    while t < text_bytes.len() {
        if p < pattern_bytes.len()
            && (pattern_bytes[p] == text_bytes[t] || pattern_bytes[p] == b'?')
        {
            p += 1;
            t += 1;
        } else if p < pattern_bytes.len() && pattern_bytes[p] == b'*' {
            star_idx = Some(p);
            match_idx = t;
            p += 1;
        } else if let Some(star_pos) = star_idx {
            p = star_pos + 1;
            match_idx += 1;
            t = match_idx;
        } else {
            return false;
        }
    }

    while p < pattern_bytes.len() && pattern_bytes[p] == b'*' {
        p += 1;
    }

    p == pattern_bytes.len()
}

pub fn ensure_within_dir(path: &Path, base_dir: &Path) -> Result<PathBuf, String> {
    let base = base_dir
        .canonicalize()
        .map_err(|e| format!("Invalid base directory: {}", e))?;

    let candidate = if path.exists() {
        path.canonicalize()
            .map_err(|e| format!("Invalid path: {}", e))?
    } else {
        let parent = path
            .parent()
            .ok_or_else(|| "Invalid path: no parent directory".to_string())?;
        let parent_canon = parent
            .canonicalize()
            .map_err(|e| format!("Invalid parent directory: {}", e))?;
        if !parent_canon.starts_with(&base) {
            return Err("Path is outside the allowed directory".to_string());
        }
        return Ok(path.to_path_buf());
    };

    if !candidate.starts_with(&base) {
        return Err("Path is outside the allowed directory".to_string());
    }

    Ok(candidate)
}

pub fn ensure_path_allowed(
    target_path: &Path,
    base_dir: &Path,
    gitignore: Option<&SimpleGitignore>,
) -> Result<PathBuf, String> {
    let canonical = ensure_within_dir(target_path, base_dir)?;
    if let Some(gitignore) = gitignore {
        if gitignore.is_ignored(base_dir, &canonical) {
            return Err("Path is ignored by .gitignore".to_string());
        }
    }
    Ok(canonical)
}
