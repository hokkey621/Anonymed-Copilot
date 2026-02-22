use futures_util::StreamExt;
use reqwest::Client;
use serde::{Deserialize, Serialize};
use std::time::Duration;
use tauri::{Emitter, Manager};

use crate::infrastructure::llm::{LlmMessage, DEFAULT_OLLAMA_BASE_URL, LOCAL_GEMMA_MODEL};
use crate::state::CancellationState;

#[derive(Serialize)]
struct OllamaChatRequest {
    model: String,
    messages: Vec<OllamaMessage>,
    stream: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    format: Option<serde_json::Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    options: Option<OllamaOptions>,
}

#[derive(Serialize)]
struct OllamaOptions {
    temperature: f32,
    num_predict: u32,
    repeat_penalty: f32,
}

#[derive(Serialize, Deserialize)]
struct OllamaMessage {
    role: String,
    content: String,
}

#[derive(Deserialize)]
struct OllamaChatResponse {
    message: Option<OllamaMessage>,
}

#[derive(Deserialize)]
struct OllamaStreamResponse {
    message: Option<OllamaMessage>,
}

pub struct OllamaHandler {
    client: Client,
    base_url: String,
}

impl OllamaHandler {
    fn build_client() -> Result<Client, String> {
        Client::builder()
            .connect_timeout(Duration::from_secs(10))
            .build()
            .map_err(|e| e.to_string())
    }

    fn normalize_base_url(base_url: &str) -> String {
        base_url.trim_end_matches('/').to_string()
    }

    pub fn with_base_url(base_url: String) -> Result<Self, String> {
        Ok(Self {
            client: Self::build_client()?,
            base_url: Self::normalize_base_url(&base_url),
        })
    }

    pub fn from_app(app: &tauri::AppHandle) -> Result<Self, String> {
        let mut base_url = DEFAULT_OLLAMA_BASE_URL.to_string();
        if let Ok(app_data_dir) = app.path().app_data_dir() {
            let settings_path = app_data_dir.join("settings.json");
            if settings_path.exists() {
                if let Ok(content) = std::fs::read_to_string(&settings_path) {
                    if let Ok(value) = serde_json::from_str::<serde_json::Value>(&content) {
                        if let Some(url) = value.get("ollama_base_url").and_then(|v| v.as_str()) {
                            if !url.trim().is_empty() {
                                base_url = url.to_string();
                            }
                        }
                    }
                }
            }
        }

        Self::with_base_url(base_url)
    }

    fn to_ollama_messages(
        history: Vec<LlmMessage>,
        system_prompt: Option<&str>,
    ) -> Vec<OllamaMessage> {
        let max_history = 12usize;
        let history_len = history.len();
        let history = if history_len > max_history {
            history
                .into_iter()
                .skip(history_len - max_history)
                .collect()
        } else {
            history
        };

        let mut messages = Vec::with_capacity(history.len() + usize::from(system_prompt.is_some()));
        if let Some(prompt) = system_prompt {
            messages.push(OllamaMessage {
                role: "system".to_string(),
                content: prompt.to_string(),
            });
        }

        messages.extend(history.into_iter().map(|m| OllamaMessage {
            role: if m.role == "model" {
                "assistant".to_string()
            } else {
                m.role
            },
            content: m.content,
        }));

        messages
    }

    fn chat_endpoint(&self) -> String {
        format!("{}/api/chat", self.base_url)
    }

    async fn chat_once(
        &self,
        history: Vec<LlmMessage>,
        system_prompt: Option<&str>,
        temperature: f32,
        num_predict: u32,
        force_json: bool,
    ) -> Result<String, String> {
        let request = OllamaChatRequest {
            model: LOCAL_GEMMA_MODEL.to_string(),
            messages: Self::to_ollama_messages(history, system_prompt),
            stream: false,
            format: if force_json {
                Some(serde_json::json!("json"))
            } else {
                None
            },
            options: Some(OllamaOptions {
                temperature,
                num_predict,
                repeat_penalty: 1.08,
            }),
        };

        let response = self
            .client
            .post(self.chat_endpoint())
            .timeout(Duration::from_secs(300))
            .json(&request)
            .send()
            .await
            .map_err(|e| {
                format!(
                    "OLLAMA_CONNECTION_ERROR: Ollama に接続できませんでした ({}): {}",
                    self.base_url, e
                )
            })?;

        if !response.status().is_success() {
            let status = response.status();
            let body = response.text().await.unwrap_or_default();
            return Err(format!(
                "OLLAMA_API_ERROR: Ollama API Error {}: {}",
                status, body
            ));
        }

        let body = response
            .json::<OllamaChatResponse>()
            .await
            .map_err(|e| format!("OLLAMA_RESPONSE_ERROR: {}", e))?;

        body.message
            .map(|m| m.content)
            .filter(|s| !s.trim().is_empty())
            .ok_or_else(|| "OLLAMA_EMPTY_RESPONSE: No content generated from Ollama".to_string())
    }

    fn sanitize_json_text(text: &str) -> String {
        let trimmed = text.trim();
        let trimmed = if trimmed.starts_with("```json") {
            trimmed.strip_prefix("```json").unwrap_or(trimmed)
        } else if trimmed.starts_with("```") {
            trimmed.strip_prefix("```").unwrap_or(trimmed)
        } else {
            trimmed
        };
        let trimmed = if trimmed.ends_with("```") {
            trimmed.strip_suffix("```").unwrap_or(trimmed)
        } else {
            trimmed
        };
        trimmed.trim().to_string()
    }

    fn repair_truncated_replacements_json(text: &str) -> Option<String> {
        let replacements_key_idx = text.find("\"replacements\"")?;
        let arr_rel_idx = text[replacements_key_idx..].find('[')?;
        let arr_start_idx = replacements_key_idx + arr_rel_idx;

        let mut in_string = false;
        let mut escape_next = false;
        let mut obj_depth: usize = 0;
        let mut last_complete_object_end: Option<usize> = None;

        let scan_start = arr_start_idx + 1;
        for (rel_idx, ch) in text[scan_start..].char_indices() {
            let idx = scan_start + rel_idx;
            if escape_next {
                escape_next = false;
                continue;
            }
            if ch == '\\' && in_string {
                escape_next = true;
                continue;
            }
            if ch == '"' {
                in_string = !in_string;
                continue;
            }
            if in_string {
                continue;
            }

            match ch {
                '{' => obj_depth += 1,
                '}' => {
                    if obj_depth > 0 {
                        obj_depth -= 1;
                        if obj_depth == 0 {
                            last_complete_object_end = Some(idx);
                        }
                    }
                }
                _ => {}
            }
        }

        let end_idx = last_complete_object_end?;
        let repaired = format!("{}\n]}}", &text[..=end_idx]);
        Some(repaired)
    }

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

        let strict_system_prompt = format!(
            "{}\n\nIMPORTANT: Return valid JSON only. Do not include markdown fences.",
            system_prompt
        );

        let mut attempt = 0;
        let max_attempts = 2;
        let mut last_error = String::new();
        // Local fast path: prioritize short first-pass generations for latency.
        // If JSON is truncated, retry path doubles this budget automatically.
        let base_num_predict = if text_context.is_some() { 384 } else { 256 };

        while attempt < max_attempts {
            attempt += 1;

            let mut turns = vec![LlmMessage {
                role: "user".to_string(),
                content: full_user_content.clone(),
            }];

            if attempt > 1 {
                turns.push(LlmMessage {
                    role: "user".to_string(),
                    content:
                        "前の出力はJSONとして壊れていました。先頭から完全なJSONを再出力してください。説明文は不要です。"
                            .to_string(),
                });
            }

            let raw = self
                .chat_once(
                    turns,
                    Some(&strict_system_prompt),
                    0.1,
                    if attempt == 1 {
                        base_num_predict
                    } else {
                        (base_num_predict * 2).min(1024)
                    },
                    true,
                )
                .await?;
            let sanitized = Self::sanitize_json_text(&raw);
            match serde_json::from_str::<T>(&sanitized) {
                Ok(parsed) => return Ok(parsed),
                Err(e) => {
                    if let Some(repaired) = Self::repair_truncated_replacements_json(&sanitized) {
                        if let Ok(parsed) = serde_json::from_str::<T>(&repaired) {
                            return Ok(parsed);
                        }
                    }
                    last_error = format!("Failed to parse JSON: {}. Text: {}", e, sanitized);
                }
            }
        }

        Err(format!("OLLAMA_JSON_PARSE_ERROR: {}", last_error))
    }

    pub async fn chat(
        &self,
        history: Vec<LlmMessage>,
        system_prompt: Option<&str>,
    ) -> Result<String, String> {
        self.chat_once(history, system_prompt, 0.7, 512, false)
            .await
    }

    pub async fn chat_streaming(
        &self,
        history: Vec<LlmMessage>,
        system_prompt: Option<&str>,
        app: &tauri::AppHandle,
    ) -> Result<String, String> {
        let request = OllamaChatRequest {
            model: LOCAL_GEMMA_MODEL.to_string(),
            messages: Self::to_ollama_messages(history, system_prompt),
            stream: true,
            format: None,
            options: Some(OllamaOptions {
                temperature: 0.4,
                num_predict: 320,
                repeat_penalty: 1.08,
            }),
        };

        let response = self
            .client
            .post(self.chat_endpoint())
            .json(&request)
            .send()
            .await
            .map_err(|e| {
                format!(
                    "OLLAMA_CONNECTION_ERROR: Ollama に接続できませんでした ({}): {}",
                    self.base_url, e
                )
            })?;

        if !response.status().is_success() {
            let status = response.status();
            let body = response.text().await.unwrap_or_default();
            return Err(format!(
                "OLLAMA_API_ERROR: Ollama API Error {}: {}",
                status, body
            ));
        }

        let mut full_text = String::new();
        let mut pending = String::new();
        let mut stream = response.bytes_stream();
        let emit_end = |reason: &str, full: &str| {
            let _ = app.emit(
                "chat-stream-end",
                serde_json::json!({
                    "full": full,
                    "reason": reason
                }),
            );
        };

        if app.state::<CancellationState>().is_chat_cancelled() {
            emit_end("cancelled", &full_text);
            return Ok(full_text);
        }

        while let Some(next) = stream.next().await {
            if app.state::<CancellationState>().is_chat_cancelled() {
                emit_end("cancelled", &full_text);
                return Ok(full_text);
            }

            let chunk = next.map_err(|e| format!("OLLAMA_STREAM_ERROR: {}", e))?;
            pending.push_str(&String::from_utf8_lossy(&chunk));

            while let Some(newline_idx) = pending.find('\n') {
                let line = pending[..newline_idx].trim().to_string();
                pending = pending[newline_idx + 1..].to_string();
                if line.is_empty() {
                    continue;
                }

                if let Ok(msg) = serde_json::from_str::<OllamaStreamResponse>(&line) {
                    if let Some(content) = msg.message.map(|m| m.content).filter(|c| !c.is_empty())
                    {
                        full_text.push_str(&content);
                        let _ = app.emit(
                            "chat-stream",
                            serde_json::json!({
                                "chunk": content,
                                "full": full_text.clone()
                            }),
                        );
                    }
                }
            }
        }

        if !pending.trim().is_empty() {
            if app.state::<CancellationState>().is_chat_cancelled() {
                emit_end("cancelled", &full_text);
                return Ok(full_text);
            }

            if let Ok(msg) = serde_json::from_str::<OllamaStreamResponse>(pending.trim()) {
                if let Some(content) = msg.message.map(|m| m.content).filter(|c| !c.is_empty()) {
                    full_text.push_str(&content);
                    let _ = app.emit(
                        "chat-stream",
                        serde_json::json!({
                            "chunk": content,
                            "full": full_text.clone()
                        }),
                    );
                }
            }
        }

        emit_end("completed", &full_text);

        if full_text.trim().is_empty() {
            return Err(
                "OLLAMA_EMPTY_RESPONSE: No content generated from streaming API".to_string(),
            );
        }

        Ok(full_text)
    }
}
