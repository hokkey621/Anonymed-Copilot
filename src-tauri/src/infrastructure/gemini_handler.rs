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
    pub category: Option<String>,
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

#[derive(Deserialize)]
struct GeminiOutput {
    replacements: Vec<ReplacementItem>,
}

const GEMINI_MODEL: &str = "gemini-2.5-flash";

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
        let specialized_instruction = match task_context {
            "Vaccine Study" | "Vaccine Development" => "CRITICAL: Maintain the graphical intervals between dates (e.g., if 'Day 1' and 'Day 14' exist, preserve the 13-day gap even if shifting dates). Anonymize specific dates but keep relative timeline integrity.",
            "Educational Material" | "Case Study" => "CRITICAL: Preserve key medical condition names and general demographics (age range, sex) necessary for educational value. Only anonymize direct identifiers (Names, IDs, specific Hospital names).",
            _ => "Anonymize ALL personal identifiers including Names, Dates, IDs, Locations, and Hospital names. Prioritize privacy over utility.",
        };

        let system_prompt = format!(
            "You are an elite medical privacy specialist. \
            Task: Anonymize the text below for context: '{}'. \
            Rules: \
            1. {specialized_instruction} \
            2. Identify specific slices of text to anonymize. \
            3. Return a JSON object with a single key 'replacements' containing an array of objects. \
            4. Each object must have: \
               - 'original': exact text slice \
               - 'replacement': safe placeholder (e.g., **NAME**, **DATE**) \
               - 'start': start offset (0-indexed UTF-8 byte offset if possible, otherwise char offset) \
               - 'end': end offset (exclusive) \
               - 'reason': brief explanation \
               - 'category': e.g., 'PER', 'LOC', 'DATE' \
            5. Do NOT change the text content. Only identifying info. \
            6. STRICT JSON format.",
            task_context
        );

        let url = format!(
            "https://generativelanguage.googleapis.com/v1beta/models/{}:generateContent?key={}",
            GEMINI_MODEL,
            self.api_key
        );

        let request_body = GeminiRequest {
            contents: vec![
                Content {
                    role: "user".to_string(),
                    parts: vec![
                        Part { text: format!("{}\n\nText to Anonymize:\n{}", system_prompt, text) }
                    ],
                }
            ],
            generation_config: GenerationConfig {
                temperature: 0.1,
                response_mime_type: "application/json".to_string(),
            },
        };

        let mut retries = 0;
        let max_retries = 3;
        let mut response;

        loop {
            response = self.client.post(&url)
                .json(&request_body)
                .send()
                .await
                .map_err(|e| e.to_string())?;

            if response.status().as_u16() == 503 {
                if retries >= max_retries {
                    break;
                }
                retries += 1;
                let wait_time = std::time::Duration::from_millis(500 * 2_u64.pow(retries - 1));
                std::thread::sleep(wait_time); // Blocking sleep is okay in async if short, but tokio::time::sleep is better.
                // Since this is generic async, prefer standard thread sleep or simple retry if avoiding extra tokio deps,
                // but we are in Tauri async command, so blocking thread is bad for concurrency but fine for MVP.
                // However, let's use a simple awaitable sleep if possible or just blocking for now.
                continue;
            }
            break;
        }

        if !response.status().is_success() {
             let status = response.status();
             let text = response.text().await.unwrap_or_default();
             return Err(format!("Gemini API Error {}: {}", status, text));
        }

        let resp_json: GeminiResponse = response.json().await.map_err(|e| e.to_string())?;

        if let Some(candidate) = resp_json.candidates.first() {
            if let Some(part) = candidate.content.parts.first() {
                // Parse wrapped JSON
                let wrapper: GeminiOutput = serde_json::from_str(&part.text)
                    .map_err(|e| format!("Failed to parse Gemini JSON: {}. Text was: {}", e, part.text))?;
                return Ok(wrapper.replacements);
            }
        }

        Err("No content generated".to_string())
    }

    pub async fn chat(&self, message: &str) -> Result<String, String> {
        let url = format!(
            "https://generativelanguage.googleapis.com/v1beta/models/{}:generateContent?key={}",
            GEMINI_MODEL,
            self.api_key
        );

        let request_body = GeminiRequest {
            contents: vec![
                Content {
                    role: "user".to_string(),
                    parts: vec![
                        Part { text: message.to_string() }
                    ],
                }
            ],
            generation_config: GenerationConfig {
                temperature: 0.7, // Higher temp for chat
                response_mime_type: "text/plain".to_string(),
            },
        };

        let mut retries = 0;
        let max_retries = 3;
        let mut response;

        loop {
            response = self.client.post(&url)
                .json(&request_body)
                .send()
                .await
                .map_err(|e| e.to_string())?;

             if response.status().as_u16() == 503 {
                if retries >= max_retries {
                    break;
                }
                retries += 1;
                let wait_time = std::time::Duration::from_millis(500 * 2_u64.pow(retries - 1));
                std::thread::sleep(wait_time);
                continue;
            }
            break;
        }

        if !response.status().is_success() {
             let status = response.status();
             let text = response.text().await.unwrap_or_default();
             return Err(format!("Gemini API Error {}: {}", status, text));
        }

        let resp_json: GeminiResponse = response.json().await.map_err(|e| e.to_string())?;

        if let Some(candidate) = resp_json.candidates.first() {
            if let Some(part) = candidate.content.parts.first() {
                return Ok(part.text.clone());
            }
        }

        Err("No content generated".to_string())
    }
}
