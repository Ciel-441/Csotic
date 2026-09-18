use crate::ollama::types::*;
use futures_util::StreamExt;
use reqwest::Client;

const DEFAULT_BASE_URL: &str = "http://localhost:11434";

pub struct OllamaClient {
    client: Client,
    base_url: String,
}

impl OllamaClient {
    pub fn new(base_url: Option<&str>) -> Self {
        Self {
            client: Client::builder()
                .timeout(std::time::Duration::from_secs(120))
                .build()
                .unwrap_or_default(),
            base_url: base_url.unwrap_or(DEFAULT_BASE_URL).trim_end_matches('/').to_string(),
        }
    }

    /// Non-streaming chat completion
    pub async fn chat(&self, request: &OllamaChatRequest) -> Result<OllamaChatResponse, String> {
        let mut req = request.clone();
        req.stream = false;

        let resp = self.client
            .post(format!("{}/api/chat", self.base_url))
            .json(&req)
            .send()
            .await
            .map_err(|e| format!("Ollama unreachable: {e}"))?;

        if !resp.status().is_success() {
            let status = resp.status();
            let body = resp.text().await.unwrap_or_default();
            return Err(format!("Ollama returned {status}: {body}"));
        }

        resp.json::<OllamaChatResponse>()
            .await
            .map_err(|e| format!("Failed to parse Ollama response: {e}"))
    }

    pub async fn chat_stream(
        &self,
        request: &OllamaChatRequest,
    ) -> Result<std::pin::Pin<Box<dyn futures_util::Stream<Item = Result<OllamaChatResponse, String>> + Send>>, String> {
        let mut req = request.clone();
        req.stream = true;

        let resp = self.client
            .post(format!("{}/api/chat", self.base_url))
            .json(&req)
            .send()
            .await
            .map_err(|e| format!("Ollama unreachable: {e}"))?;

        if !resp.status().is_success() {
            let status = resp.status();
            let body = resp.text().await.unwrap_or_default();
            return Err(format!("Ollama returned {status}: {body}"));
        }

        let bytes_stream = resp.bytes_stream();
        let state = (bytes_stream, Vec::<u8>::new());

        let stream = futures_util::stream::unfold(state, |(mut stream, mut buffer)| async move {
            loop {
                if let Some(pos) = buffer.iter().position(|&b| b == b'\n') {
                    let line_bytes = buffer.drain(..=pos).collect::<Vec<u8>>();
                    let line = String::from_utf8_lossy(&line_bytes);
                    let line = line.trim();
                    if line.is_empty() { continue; }
                    
                    match serde_json::from_str::<OllamaChatResponse>(line) {
                        Ok(parsed) => {
                            return Some((Ok(parsed), (stream, buffer)));
                        }
                        Err(e) => {
                            return Some((Err(format!("JSON parse error: {e} on line: {line}")), (stream, buffer)));
                        }
                    }
                }

                match stream.next().await {
                    Some(Ok(bytes)) => {
                        buffer.extend_from_slice(&bytes);
                    }
                    Some(Err(e)) => {
                        return Some((Err(format!("Stream read error: {e}")), (stream, buffer)));
                    }
                    None => {
                        if !buffer.is_empty() {
                            let line = String::from_utf8_lossy(&buffer).into_owned();
                            let line_trimmed = line.trim();
                            buffer.clear();
                            if !line_trimmed.is_empty() {
                                match serde_json::from_str::<OllamaChatResponse>(line_trimmed) {
                                    Ok(parsed) => {
                                        return Some((Ok(parsed), (stream, buffer)));
                                    }
                                    Err(e) => {
                                        return Some((Err(format!("JSON parse error: {e} on leftover: {line}")), (stream, buffer)));
                                    }
                                }
                            }
                        }
                        return None;
                    }
                }
            }
        });

        Ok(Box::pin(stream))
    }

    /// List available models
    pub async fn tags(&self) -> Result<OllamaTagsResponse, String> {
        let resp = self.client
            .get(format!("{}/api/tags", self.base_url))
            .timeout(std::time::Duration::from_secs(5))
            .send()
            .await
            .map_err(|e| format!("Ollama unreachable: {e}"))?;

        resp.json::<OllamaTagsResponse>()
            .await
            .map_err(|e| format!("Failed to parse tags response: {e}"))
    }

    /// Show model details (for context window)
    pub async fn show(&self, model: &str) -> Result<OllamaShowResponse, String> {
        let resp = self.client
            .post(format!("{}/api/show", self.base_url))
            .json(&OllamaShowRequest { name: model.to_string() })
            .timeout(std::time::Duration::from_secs(10))
            .send()
            .await
            .map_err(|e| format!("Ollama unreachable: {e}"))?;

        resp.json::<OllamaShowResponse>()
            .await
            .map_err(|e| format!("Failed to parse show response: {e}"))
    }

    /// Quick health check — can we reach Ollama?
    pub async fn is_reachable(&self) -> bool {
        self.client
            .get(format!("{}/api/tags", self.base_url))
            .timeout(std::time::Duration::from_secs(3))
            .send()
            .await
            .map(|r| r.status().is_success())
            .unwrap_or(false)
    }
}
