use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OllamaMessage {
    pub role: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub content: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tool_calls: Option<Vec<OllamaToolCall>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub images: Option<Vec<String>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OllamaToolCall {
    pub function: OllamaFunctionCall,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OllamaFunctionCall {
    pub name: String,
    pub arguments: serde_json::Value,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OllamaChatRequest {
    pub model: String,
    pub messages: Vec<OllamaMessage>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tools: Option<Vec<serde_json::Value>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub options: Option<serde_json::Value>,
    pub stream: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OllamaChatResponse {
    pub message: Option<OllamaMessage>,
    pub done: Option<bool>,
    #[serde(default)]
    pub done_reason: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OllamaTagsResponse {
    pub models: Option<Vec<OllamaModelInfo>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OllamaModelInfo {
    pub name: String,
    #[serde(default)]
    pub model: Option<String>,
    #[serde(default)]
    pub size: Option<u64>,
    #[serde(default)]
    pub details: Option<OllamaModelDetails>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OllamaModelDetails {
    pub format: Option<String>,
    pub family: Option<String>,
    pub parameter_size: Option<String>,
    pub quantization_level: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OllamaShowRequest {
    pub name: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OllamaShowResponse {
    #[serde(default)]
    pub parameters: Option<String>,
    #[serde(default)]
    pub modelinfo: Option<serde_json::Value>,
    #[serde(default)]
    pub details: Option<OllamaModelDetails>,
}

impl OllamaMessage {
    pub fn system(content: &str) -> Self {
        Self { role: "system".into(), content: Some(content.into()), tool_calls: None, images: None }
    }
    pub fn user(content: &str) -> Self {
        Self { role: "user".into(), content: Some(content.into()), tool_calls: None, images: None }
    }
    pub fn user_with_images(content: &str, images: Vec<String>) -> Self {
        Self { role: "user".into(), content: Some(content.into()), tool_calls: None, images: Some(images) }
    }
    pub fn assistant(content: &str) -> Self {
        Self { role: "assistant".into(), content: Some(content.into()), tool_calls: None, images: None }
    }
    #[allow(dead_code)]
    pub fn assistant_tool_calls(calls: Vec<OllamaToolCall>) -> Self {
        Self { role: "assistant".into(), content: None, tool_calls: Some(calls), images: None }
    }
    pub fn tool(content: &str) -> Self {
        Self { role: "tool".into(), content: Some(content.into()), tool_calls: None, images: None }
    }
}
