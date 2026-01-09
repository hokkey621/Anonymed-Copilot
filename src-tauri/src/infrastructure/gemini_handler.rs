use reqwest::Client;
use serde::{Deserialize, Serialize};
use std::env;
use dotenv::dotenv;

use crate::domain::model::ReplacementEntry;

#[derive(Deserialize)]
struct GeminiResponse {
    candidates: Vec<Candidate>,
}

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

#[derive(Deserialize)]
struct GeminiOutput {
    replacements: Vec<ReplacementEntry>,
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

const GEMINI_MODEL: &str = "gemini-2.5-flash";

impl GeminiHandler {
    pub fn new() -> Result<Self, String> {
        dotenv().ok();
        let api_key = env::var("GOOGLE_API_KEY").map_err(|_| "GOOGLE_API_KEY not set".to_string())?;
        Ok(Self { client: Client::new(), api_key })
    }

    async fn send_with_retry(&self, request_body: &GeminiRequest) -> Result<reqwest::Response, String> {
        let url = format!(
            "https://generativelanguage.googleapis.com/v1beta/models/{}:generateContent?key={}",
            GEMINI_MODEL, self.api_key
        );

        let max_retries = 3;
        let mut retries = 0;

        loop {
            let response = self.client.post(&url).json(request_body).send().await.map_err(|e| e.to_string())?;

            if response.status().as_u16() == 503 {
                if retries >= max_retries { return Err("Gemini API overloaded (503) after max retries".to_string()); }
                retries += 1;
                tokio::time::sleep(std::time::Duration::from_millis(500 * 2_u64.pow(retries - 1))).await;
                continue;
            }
            if !response.status().is_success() {
                let status = response.status();
                let text = response.text().await.unwrap_or_default();
                return Err(format!("Gemini API Error {}: {}", status, text));
            }
            return Ok(response);
        }
    }

    /// Analyze text and return structured replacements (for Execute button)
    pub async fn analyze(&self, text: &str, task_context: &str) -> Result<Vec<ReplacementEntry>, String> {
        let specialized_instruction = match task_context {
            "Vaccine Study" | "Vaccine Development" => "CRITICAL: Maintain the graphical intervals between dates. Anonymize specific dates to relative days (Day 0, Day 14). Unify facility names to Site A, Site B.",
            "Educational Material" | "Case Study" => "CRITICAL: Preserve key medical condition names and general demographics. Only anonymize direct identifiers.",
            _ => "Anonymize ALL personal identifiers including Names, Dates, IDs, Locations, and Hospital names.",
        };

        let system_prompt = format!(
            "You are an elite medical privacy specialist. Task: Anonymize the text below for context: '{}'. Rules: 1. {} 2. Return JSON with 'replacements' array. Each object: 'original' (exact text), 'replacement', 'start', 'end', 'reason', 'category'. 3. STRICT JSON.",
            task_context, specialized_instruction
        );

        let request_body = GeminiRequest {
            contents: vec![Content { role: "user".to_string(), parts: vec![Part { text: format!("{}\n\nText:\n{}", system_prompt, text) }] }],
            generation_config: GenerationConfig { temperature: 0.1, response_mime_type: "application/json".to_string() },
        };

        let response = self.send_with_retry(&request_body).await?;
        let resp_json: GeminiResponse = response.json().await.map_err(|e| e.to_string())?;

        if let Some(candidate) = resp_json.candidates.first() {
            if let Some(part) = candidate.content.parts.first() {
                let wrapper: GeminiOutput = serde_json::from_str(&part.text)
                    .map_err(|e| format!("Failed to parse Gemini JSON: {}. Text: {}", e, part.text))?;
                return Ok(wrapper.replacements);
            }
        }
        Err("No content generated".to_string())
    }

    /// Simple chat for conversational discussion (no structured JSON)
    pub async fn chat(&self, message: &str) -> Result<String, String> {
        let request_body = GeminiRequest {
            contents: vec![Content { role: "user".to_string(), parts: vec![Part { text: message.to_string() }] }],
            generation_config: GenerationConfig { temperature: 0.7, response_mime_type: "text/plain".to_string() },
        };

        let response = self.send_with_retry(&request_body).await?;
        let resp_json: GeminiResponse = response.json().await.map_err(|e| e.to_string())?;

        if let Some(candidate) = resp_json.candidates.first() {
            if let Some(part) = candidate.content.parts.first() {
                return Ok(part.text.clone());
            }
        }
        Err("No content generated".to_string())
    }
}
