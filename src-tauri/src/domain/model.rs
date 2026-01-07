use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MedicalRecord {
    pub id: String,
    pub content: String,
    // Add more fields as needed
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AnonPlan {
    pub items: Vec<String>, // Placeholder
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
