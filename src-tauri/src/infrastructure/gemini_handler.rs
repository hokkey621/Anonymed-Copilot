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
pub struct GeminiRequest {
    pub contents: Vec<Content>,
    pub system_instruction: Option<SystemInstruction>,
    #[serde(rename = "generationConfig")]
    pub generation_config: GenerationConfig,
}

#[derive(Serialize)]
pub struct SystemInstruction {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub role: Option<String>,
    pub parts: Vec<Part>,
}

#[derive(Serialize)]
pub struct Content {
    pub role: String,
    pub parts: Vec<Part>,
}

#[derive(Serialize)]
pub struct Part {
    pub text: String,
}

#[derive(Serialize)]
pub struct GenerationConfig {
    pub temperature: f32,
    #[serde(rename = "responseMimeType")]
    pub response_mime_type: String,
}

#[allow(dead_code)]
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

    /// Generic method to call Gemini with a system prompt and parse JSON output
    pub async fn generate_structure<T: serde::de::DeserializeOwned>(
        &self,
        user_prompt: &str,
        system_prompt: &str,
        text_context: Option<&str>,
    ) -> Result<T, String> {
        let full_user_content = if let Some(ctx) = text_context {
            format!("{}\n\nContext Text:\n{}", user_prompt, ctx)
        } else {
            user_prompt.to_string()
        };

        let request_body = GeminiRequest {
            contents: vec![Content {
                role: "user".to_string(),
                parts: vec![Part { text: full_user_content }],
            }],
            system_instruction: Some(SystemInstruction {
                role: None,
                parts: vec![Part { text: system_prompt.to_string() }],
            }),
            generation_config: GenerationConfig {
                temperature: 0.1,
                response_mime_type: "application/json".to_string(),
            },
        };

        let response = self.send_with_retry(&request_body).await?;
        let resp_json: GeminiResponse = response.json().await.map_err(|e| e.to_string())?;

        if let Some(candidate) = resp_json.candidates.first() {
            if let Some(part) = candidate.content.parts.first() {
                serde_json::from_str(&part.text).map_err(|e| {
                    format!("Failed to parse JSON: {}. Text: {}", e, part.text)
                })
            } else {
                Err("No content part in candidate".to_string())
            }
        } else {
            Err("No candidates returned".to_string())
        }
    }

    /// Multi-turn chat with history
    pub async fn chat(&self, history: Vec<Content>) -> Result<String, String> {
        let request_body = GeminiRequest {
            contents: history,
            system_instruction: None,
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
