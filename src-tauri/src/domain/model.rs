use std::collections::HashMap;
use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MedicalRecord {
    pub id: String,
    pub content: String,
    // Add more fields as needed
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ReplacementEntry {
    pub original: String,
    pub replacement: String,
    #[serde(default)]
    pub start: usize,
    #[serde(default)]
    pub end: usize,
    pub reason: String,
    pub category: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AnonPlan {
    pub task_name: String,
    pub global_rules: HashMap<String, Value>,
    pub replacements: Vec<ReplacementEntry>,
    pub status: String, // "draft" | "approved"
    #[serde(default)]
    pub applied_skills: Vec<String>, // Names of skills that were applied
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AgentResponse {
    pub message: String,
    pub plan: AnonPlan,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FileEntry {
    pub name: String,
    pub path: String,
    pub is_dir: bool,
    pub size: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AuditLog {
    pub task_context: String,
    pub applied_rules: Vec<String>,
    pub user_overrides: Vec<String>,
    pub privacy_score: f64,
    pub data_hash: String,
    pub timestamp: String,
    pub signature: Option<String>, // HMAC Signature
}

/// Plan for bulk execution across multiple files
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BulkExecutionPlan {
    pub target_count: usize,
    pub estimated_time_ms: u64,
    pub policy_summary: Vec<String>,
}

/// Individual step in a workflow
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WorkflowStep {
    pub id: String,
    pub label: String,
    pub status: String, // "pending" | "running" | "completed" | "failed"
}
