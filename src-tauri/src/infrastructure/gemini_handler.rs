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

const GEMINI_MODEL: &str = "gemini-3-flash-preview";

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
                // Sanitize the JSON text to remove invalid characters
                let sanitized = Self::sanitize_json_text(&part.text);
                serde_json::from_str(&sanitized).map_err(|e| {
                    format!("Failed to parse JSON: {}. Text: {}", e, sanitized)
                })
            } else {
                Err("No content part in candidate".to_string())
            }
        } else {
            Err("No candidates returned".to_string())
        }
    }

    /// Sanitize JSON text by removing non-ASCII characters that shouldn't be in JSON structure
    fn sanitize_json_text(text: &str) -> String {
        // Remove markdown code block markers if present
        let text = text.trim();
        let text = if text.starts_with("```json") {
            text.strip_prefix("```json").unwrap_or(text)
        } else if text.starts_with("```") {
            text.strip_prefix("```").unwrap_or(text)
        } else {
            text
        };
        let text = if text.ends_with("```") {
            text.strip_suffix("```").unwrap_or(text)
        } else {
            text
        };
        let text = text.trim();

        // Clean up invalid characters in JSON structure parts
        let mut result = String::with_capacity(text.len());
        let mut in_string = false;
        let mut escape_next = false;

        for ch in text.chars() {
            if escape_next {
                result.push(ch);
                escape_next = false;
                continue;
            }

            if ch == '\\' && in_string {
                result.push(ch);
                escape_next = true;
                continue;
            }

            if ch == '"' {
                in_string = !in_string;
                result.push(ch);
                continue;
            }

            if in_string {
                // Inside a string, allow most characters (including Unicode)
                result.push(ch);
            } else {
                // Outside of string, only allow valid JSON structural characters
                if ch.is_ascii() || ch.is_whitespace() {
                    // Filter out non-JSON structural characters outside strings
                    if ch.is_ascii_alphanumeric()
                        || ch.is_ascii_whitespace()
                        || "{}[],:\".-+eE_".contains(ch) {
                        result.push(ch);
                    }
                    // Skip other characters like random Unicode outside strings
                }
                // Skip non-ASCII characters outside of strings entirely
            }
        }

        result
    }

    /// Multi-turn chat with history
    /// Accepts optional system_instruction for proper system prompting
    pub async fn chat(&self, history: Vec<Content>, system_prompt: Option<&str>) -> Result<String, String> {
        let request_body = GeminiRequest {
            contents: history,
            system_instruction: system_prompt.map(|s| SystemInstruction {
                role: None,
                parts: vec![Part { text: s.to_string() }],
            }),
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

    /// Multi-turn chat with streaming via Tauri events
    /// Accepts optional system_instruction for proper system prompting
    pub async fn chat_streaming(&self, history: Vec<Content>, system_prompt: Option<&str>, app: &tauri::AppHandle) -> Result<String, String> {
        use futures_util::StreamExt;
        use tauri::Emitter;

        let url = format!(
            "https://generativelanguage.googleapis.com/v1beta/models/{}:streamGenerateContent?key={}&alt=sse",
            GEMINI_MODEL, self.api_key
        );

        let request_body = GeminiRequest {
            contents: history,
            system_instruction: system_prompt.map(|s| SystemInstruction {
                role: None,
                parts: vec![Part { text: s.to_string() }],
            }),
            generation_config: GenerationConfig { temperature: 0.7, response_mime_type: "text/plain".to_string() },
        };

        let response = self.client
            .post(&url)
            .json(&request_body)
            .send()
            .await
            .map_err(|e| e.to_string())?;

        if !response.status().is_success() {
            let status = response.status();
            let text = response.text().await.unwrap_or_default();
            return Err(format!("Gemini API Error {}: {}", status, text));
        }

        let mut full_text = String::new();
        let mut stream = response.bytes_stream();

        while let Some(chunk_result) = stream.next().await {
            match chunk_result {
                Ok(chunk) => {
                    let chunk_str = String::from_utf8_lossy(&chunk);
                    // Parse SSE format: data: {...}
                    for line in chunk_str.lines() {
                        if let Some(json_str) = line.strip_prefix("data: ") {
                            if let Ok(resp) = serde_json::from_str::<GeminiResponse>(json_str) {
                                if let Some(candidate) = resp.candidates.first() {
                                    if let Some(part) = candidate.content.parts.first() {
                                        full_text.push_str(&part.text);
                                        // Emit streaming event
                                        let _ = app.emit("chat-stream", serde_json::json!({
                                            "chunk": part.text.clone(),
                                            "full": full_text.clone()
                                        }));
                                    }
                                }
                            }
                        }
                    }
                }
                Err(e) => return Err(e.to_string()),
            }
        }

        // Emit completion event
        let _ = app.emit("chat-stream-end", serde_json::json!({
            "full": full_text.clone()
        }));

        Ok(full_text)
    }
}
