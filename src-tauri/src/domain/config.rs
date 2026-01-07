use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AnonymizationConfig {
    pub rules: Vec<String>, // Placeholder
}
