use serde::Serialize;
use tauri::Emitter;

#[derive(Debug, Clone, Serialize)]
pub struct ModelStreamEvent {
    pub request_id: Option<String>,
    pub delta: Option<String>,
    pub error: Option<String>,
    pub finished: bool,
}

#[derive(Debug, Clone, Serialize)]
pub struct FileDiff {
    pub path: String,
    #[serde(rename = "oldContent")]
    pub old_content: String,
    #[serde(rename = "newContent")]
    pub new_content: String,
}

/// Event payload for agent-file-edited — wraps FileDiff with request_id for conversation routing
#[derive(Debug, Clone, Serialize)]
pub struct FileEditedEvent {
    pub request_id: String,
    pub path: String,
    #[serde(rename = "oldContent")]
    pub old_content: String,
    #[serde(rename = "newContent")]
    pub new_content: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct AgentChatResponse {
    pub request_id: Option<String>,
    pub text: Option<String>,
    pub finished: Option<bool>,
}

#[derive(Debug, Clone, Serialize)]
pub struct AgentStateUpdate {
    pub status: String,
    pub objective: String,
    pub plan_steps: Vec<PlanStep>,
    pub current_step_idx: Option<usize>,
    pub elapsed_ms: u64,
}

#[derive(Debug, Clone, Serialize)]
pub struct PlanStep {
    pub description: String,
    pub status: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub files: Option<Vec<String>>,
}

pub fn emit_model_stream(app: &tauri::AppHandle, event: ModelStreamEvent) {
    let _ = app.emit("model-stream", event);
}

pub fn emit_file_edited(app: &tauri::AppHandle, request_id: &str, diff: FileDiff) {
    let _ = app.emit("agent-file-edited", FileEditedEvent {
        request_id: request_id.to_string(),
        path: diff.path,
        old_content: diff.old_content,
        new_content: diff.new_content,
    });
}

pub fn emit_agent_chat(app: &tauri::AppHandle, request_id: &str, text: &str, finished: bool) {
    let _ = app.emit("agent-chat-response", AgentChatResponse {
        request_id: Some(request_id.to_string()),
        text: Some(text.to_string()),
        finished: Some(finished),
    });
}

pub fn emit_agent_state(
    app: &tauri::AppHandle,
    status: &str,
    objective: &str,
    plan_steps: &[PlanStep],
    current_step_idx: Option<usize>,
    elapsed: std::time::Duration,
) {
    let _ = app.emit("agent-state-update", AgentStateUpdate {
        status: status.to_string(),
        objective: objective.to_string(),
        plan_steps: plan_steps.to_vec(),
        current_step_idx,
        elapsed_ms: elapsed.as_millis() as u64,
    });
}
