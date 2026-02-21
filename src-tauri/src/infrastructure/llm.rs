use serde::{Deserialize, Serialize};

use crate::infrastructure::gemini_handler::GeminiHandler;
use crate::infrastructure::ollama_handler::OllamaHandler;

pub const DEFAULT_OLLAMA_BASE_URL: &str = "http://127.0.0.1:11434";
pub const LOCAL_GEMMA_MODEL: &str = "gemma3:4b-it-qat";

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ModelProvider {
    Gemini,
    LocalGemma,
}

impl Default for ModelProvider {
    fn default() -> Self {
        Self::Gemini
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LlmMessage {
    pub role: String,
    pub content: String,
}

pub enum LlmClient {
    Gemini(GeminiHandler),
    Ollama(OllamaHandler),
}

impl LlmClient {
    pub fn from_app(app: &tauri::AppHandle, provider: ModelProvider) -> Result<Self, String> {
        match provider {
            ModelProvider::Gemini => Ok(Self::Gemini(GeminiHandler::from_app(app)?)),
            ModelProvider::LocalGemma => Ok(Self::Ollama(OllamaHandler::from_app(app)?)),
        }
    }

    pub async fn generate_structure<T: serde::de::DeserializeOwned>(
        &self,
        user_prompt: &str,
        system_prompt: &str,
        text_context: Option<&str>,
    ) -> Result<T, String> {
        match self {
            Self::Gemini(client) => {
                client
                    .generate_structure(user_prompt, system_prompt, text_context)
                    .await
            }
            Self::Ollama(client) => {
                client
                    .generate_structure(user_prompt, system_prompt, text_context)
                    .await
            }
        }
    }

    pub async fn chat(
        &self,
        history: Vec<LlmMessage>,
        system_prompt: Option<&str>,
    ) -> Result<String, String> {
        match self {
            Self::Gemini(client) => client.chat(history, system_prompt).await,
            Self::Ollama(client) => client.chat(history, system_prompt).await,
        }
    }

    pub async fn chat_streaming(
        &self,
        history: Vec<LlmMessage>,
        system_prompt: Option<&str>,
        app: &tauri::AppHandle,
    ) -> Result<String, String> {
        match self {
            Self::Gemini(client) => client.chat_streaming(history, system_prompt, app).await,
            Self::Ollama(client) => client.chat_streaming(history, system_prompt, app).await,
        }
    }

    pub fn provider(&self) -> ModelProvider {
        match self {
            Self::Gemini(_) => ModelProvider::Gemini,
            Self::Ollama(_) => ModelProvider::LocalGemma,
        }
    }
}
