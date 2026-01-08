use reqwest::Client;
use serde::{Deserialize, Serialize};
use std::env;
use dotenv::dotenv;

#[derive(Serialize)]
struct GeminiRequest {
    contents: Vec<Content>,
    #[serde(rename = "generationConfig")]
    generation_config: GenerationConfig,
}

#[derive(Serialize)]
struct Content {
    role: String,
    parts: Vec<Part>,
}

#[derive(Serialize)]
struct Part {
    text: String,
}

#[derive(Serialize)]
struct GenerationConfig {
    temperature: f32,
    #[serde(rename = "responseMimeType")]
    response_mime_type: String,
}

#[derive(Debug, Deserialize, Serialize, Clone)]
pub struct ReplacementItem {
    pub original: String,
    pub replacement: String,
    pub start: usize,
    pub end: usize,
    pub reason: String,
}

#[derive(Deserialize)]
struct GeminiResponse {
    candidates: Vec<Candidate>,
}

#[derive(Deserialize)]
struct Candidate {
    content: ContentResponse,
}

#[derive(Deserialize)]
struct ContentResponse {
    parts: Vec<PartResponse>,
}

#[derive(Deserialize)]
struct PartResponse {
    text: String,
}

pub struct GeminiHandler {
    client: Client,
    api_key: String,
}

impl GeminiHandler {
    pub fn new() -> Result<Self, String> {
        dotenv().ok(); // Load .env
        let api_key = env::var("GOOGLE_API_KEY").map_err(|_| "GOOGLE_API_KEY not set".to_string())?;

        Ok(Self {
            client: Client::new(),
            api_key,
        })
    }

    pub async fn analyze(&self, text: &str, task_context: &str) -> Result<Vec<ReplacementItem>, String> {
        let system_prompt = format!(
            "You are a specialized medical privacy agent. \
            Task: Anonymize the following text for '{}'. \
            Identify SENSITIVE personal information (Names, exact dates, IDs, hospitals, locations) that MUST be anonymized. \
            Return ONLY a JSON array of objects with fields: 'original', 'replacement' (use placeholders like **NAME**), 'start' (0-indexed start offset), 'end' (0-indexed end offset), and 'reason'. \
            Do NOT modify the text structure. Do NOT output markdown code blocks. Just the raw JSON array. \
            Strictly follow the JSON format.",
            task_context
        );

        let url = format!(
            "https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key={}",
            self.api_key
        );

        let request_body = GeminiRequest {
            contents: vec![
                Content {
                    role: "user".to_string(),
                    parts: vec![
                        Part { text: format!("{}\n\nText:\n{}", system_prompt, text) }
                    ],
                }
            ],
            generation_config: GenerationConfig {
                temperature: 0.1, // Low temp for deterministic format
                response_mime_type: "application/json".to_string(),
            },
        };

        let response = self.client.post(&url)
            .json(&request_body)
            .send()
            .await
            .map_err(|e| e.to_string())?;

        if !response.status().is_success() {
             return Err(format!("Gemini API Error: {}", response.status()));
        }

        let resp_json: GeminiResponse = response.json().await.map_err(|e| e.to_string())?;

        if let Some(candidate) = resp_json.candidates.first() {
            if let Some(part) = candidate.content.parts.first() {
                // Parse the JSON text from the response
                let replacements: Vec<ReplacementItem> = serde_json::from_str(&part.text)
                    .map_err(|e| format!("Failed to parse Gemini JSON: {}. Text was: {}", e, part.text))?;
                return Ok(replacements);
            }
        }

        Err("No content generated".to_string())
    }
}
