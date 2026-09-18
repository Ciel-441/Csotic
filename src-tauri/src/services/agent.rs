use std::time::Instant;
use std::collections::HashMap;
use std::sync::{Arc, OnceLock, Mutex as StdMutex};
use std::sync::atomic::{AtomicBool, Ordering};
use tokio::sync::Mutex as AsyncMutex;
use serde_json::{json, Value};
use tauri::{AppHandle, Manager};
use crate::ollama::client::OllamaClient;
use crate::ollama::types::{OllamaMessage, OllamaChatRequest, OllamaToolCall, OllamaFunctionCall};
use crate::events::{emit_agent_state, emit_agent_chat, emit_file_edited, PlanStep, FileDiff};
use crate::services::{filesystem, terminal};

const MAX_STEPS: u32 = 25;
const MAX_TOOL_OUTPUT_CHARS: usize = 8000;
/// Default context window (tokens). Overridden per-model via /api/show when available.
const DEFAULT_CONTEXT_WINDOW: usize = 8192;
/// Start compacting when messages exceed this fraction of the context window.
const CONTEXT_COMPACT_THRESHOLD: f64 = 0.75;

// ─────────────────────────────────────────────────────────────────────────────
// Cancellation registry — lets a running agent task be stopped early by request_id,
// and gives the timeout/error path something real to report instead of nothing.
// ─────────────────────────────────────────────────────────────────────────────

type CancelFlag = Arc<AtomicBool>;
type SharedPlanSteps = Arc<AsyncMutex<Vec<PlanStep>>>;

struct RunHandle {
    cancel: CancelFlag,
    plan_steps: SharedPlanSteps,
}

fn registry() -> &'static StdMutex<HashMap<String, RunHandle>> {
    static REGISTRY: OnceLock<StdMutex<HashMap<String, RunHandle>>> = OnceLock::new();
    REGISTRY.get_or_init(|| StdMutex::new(HashMap::new()))
}

fn register_run(request_id: &str) -> (CancelFlag, SharedPlanSteps) {
    let cancel = Arc::new(AtomicBool::new(false));
    let plan_steps: SharedPlanSteps = Arc::new(AsyncMutex::new(Vec::new()));
    if let Ok(mut reg) = registry().lock() {
        reg.insert(request_id.to_string(), RunHandle {
            cancel: cancel.clone(),
            plan_steps: plan_steps.clone(),
        });
    }
    (cancel, plan_steps)
}

fn unregister_run(request_id: &str) {
    if let Ok(mut reg) = registry().lock() {
        reg.remove(request_id);
    }
}

/// Snapshot of plan_steps for a request, used to report real progress on
/// timeout/cancel instead of an empty list.
async fn snapshot_plan_steps(request_id: &str) -> Vec<PlanStep> {
    let handle = registry().lock().ok().and_then(|reg| reg.get(request_id).map(|h| h.plan_steps.clone()));
    match handle {
        Some(steps) => steps.lock().await.clone(),
        None => Vec::new(),
    }
}

pub async fn handle(
    app: &AppHandle,
    action: &str,
    payload: &Value,
    process_handle: &terminal::ProcessHandle,
    db: &std::sync::Mutex<rusqlite::Connection>,
) -> Result<Value, String> {
    let active_files: Vec<String> = payload.get("active_files")
        .and_then(|v| v.as_array())
        .map(|arr| arr.iter().filter_map(|v| v.as_str().map(|s| s.to_string())).collect())
        .unwrap_or_default();

    match action {
        "execute_request" => {
            let request = payload.get("request").and_then(Value::as_str)
                .ok_or("Missing 'request'")?.to_string();
            let project_path = payload.get("project_path").and_then(Value::as_str)
                .ok_or("Missing 'project_path'")?.to_string();
            let model_id = payload.get("model_id").and_then(Value::as_str)
                .ok_or("Missing 'model_id'")?.to_string();
            let permission_profile = payload.get("permission_profile").and_then(Value::as_str)
                .unwrap_or("developer").to_string();
            let request_id = payload.get("request_id").and_then(Value::as_str)
                .map(|s| s.to_string())
                .unwrap_or_else(|| uuid::Uuid::new_v4().to_string());
            let image_paths: Vec<String> = payload.get("image_paths")
                .and_then(|v| v.as_array())
                .map(|arr| arr.iter().filter_map(|v| v.as_str().map(|s| s.to_string())).collect())
                .unwrap_or_default();
            let history_json = payload.get("history").and_then(|v| v.as_array());
            let intent = payload.get("intent").and_then(|v| v.as_str()).map(|s| s.to_string());
            let mut history_messages = Vec::new();
            if let Some(arr) = history_json {
                for val in arr {
                    if let (Some(role), Some(content)) = (val.get("role").and_then(|v| v.as_str()), val.get("content").and_then(|v| v.as_str())) {
                        if role == "user" {
                            history_messages.push(OllamaMessage::user(content));
                        } else {
                            history_messages.push(OllamaMessage::assistant(content));
                        }
                    }
                }
            }

            let app_clone = app.clone();
            let process_handle_clone = process_handle.clone();
            let (cancel_flag, plan_steps_handle) = register_run(&request_id);

            let mut api_keys = HashMap::new();
            for p in &["openai", "anthropic", "deepseek", "groq", "openrouter", "gemini", "custom_endpoints"] {
                if let Some(key) = crate::services::models::get_api_key(db, p) {
                    api_keys.insert(p.to_string(), key);
                }
            }

            let synthesis = crate::services::context::ContextEngine::synthesize_context(
                &project_path,
                &request,
                &active_files,
                db
            );

            // Spawn async task for agent loop, return immediately
            tokio::spawn(async move {
                let request_id_err = request_id.clone();
                let app_clone_err = app_clone.clone();
                let objective_err = request.clone();
                let result = tokio::select! {
                    _res = run_agent_loop(
                        app_clone,
                        request_id.clone(),
                        request,
                        project_path,
                        model_id,
                        permission_profile,
                        process_handle_clone,
                        image_paths,
                        history_messages,
                        cancel_flag,
                        plan_steps_handle,
                        synthesis,
                        intent,
                        api_keys,
                    ) => {
                        Ok(())
                    }
                    _ = tokio::time::sleep(std::time::Duration::from_secs(600)) => {

                        Err("Agent loop timed out after 10 minutes".to_string())
                    }
                };

                if let Err(e) = result {
                    // Report what was actually completed before the timeout, not an empty list.
                    let real_progress = snapshot_plan_steps(&request_id_err).await;
                    emit_agent_chat(
                        &app_clone_err,
                        &request_id_err,
                        &format!(
                            "Agent stopped: {e}. Completed {} step(s) before stopping — you can continue with a follow-up request.",
                            real_progress.iter().filter(|s| s.status == "completed").count()
                        ),
                        true,
                    );
                    emit_agent_state(&app_clone_err, "completed", &objective_err, &real_progress, None, std::time::Duration::default());
                }

                unregister_run(&request_id_err);
            });

            Ok(json!({ "started": true }))
        }
        "cancel_request" => {
            let request_id = payload.get("request_id").and_then(Value::as_str)
                .ok_or("Missing 'request_id'")?;
            let found = registry().lock().ok().and_then(|reg| reg.get(request_id).map(|h| h.cancel.clone()));
            match found {
                Some(flag) => {
                    flag.store(true, Ordering::SeqCst);
                    Ok(json!({ "cancelled": true }))
                }
                None => Ok(json!({ "cancelled": false, "reason": "No running agent task with that request_id" })),
            }
        }
        _ => Err(format!("Unknown agent action: {action}")),
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Phase 3 & 5: System prompt and Intent Behavior Nudges
// ─────────────────────────────────────────────────────────────────────────────

fn build_system_prompt(project_path: &str, permission: &str, synthesis: &crate::services::context::ContextSynthesis, _intent: Option<&str>) -> String {
    let explanation = match permission {
        "read_only" => "You may only read files and inspect the workspace. You cannot modify files or run terminal commands.",
        "edit" => "You may read, write, and patch files in the workspace. You cannot run shell commands.",
        "developer" => "You may read/write files and run non-destructive commands (builds, tests, linters, git status/diff). Destructive commands require approval.",
        "full_automation" => "You have full access to read/write files and execute terminal commands in this workspace.",
        _ => "You may inspect files.",
    };

    let project_state = crate::services::project_state::ProjectDetector::detect(project_path);
    let project_header = format!(
        "\n\n[Workspace Context]\n\
         - Root Path: {}\n\
         - Project Type: {}\n\
         - Package Manager: {}\n\
         - Files: {} files across {} directories\n\
         - Discovered Entry Points: {}\n\
         - Configuration Manifests: {}\n\
         - Status: {}",
        project_path,
        project_state.project_type_name,
        project_state.package_manager,
        project_state.file_count,
        project_state.directory_count,
        if project_state.entry_points.is_empty() { "None".to_string() } else { project_state.entry_points.join(", ") },
        if project_state.important_files.is_empty() { "None".to_string() } else { project_state.important_files.join(", ") },
        if project_state.project_exists { "Existing Project" } else { "Empty Directory" }
    );

    let memory = if synthesis.memory_summary.is_empty() { String::new() } else { format!("\n\n[Project Context & Memory]\n{}", synthesis.memory_summary) };
    let brain = if synthesis.brain_context.is_empty() { String::new() } else { format!("\n\n[Project Architecture Vault]\n{}", synthesis.brain_context) };
    let git = if synthesis.git_diff.is_empty() { String::new() } else { format!("\n\n[Current Git Diff]\n{}", synthesis.git_diff) };

    format!(
        "You are Csotic, an expert software engineer and AI pair programmer. You help the user build, modify, debug, and understand software in their workspace.{project_header}{memory}{brain}{git}

Core Operating Guidelines:
1. Think carefully and reason step-by-step to understand the problem before modifying code.
2. Read relevant existing files before editing or patching them to understand existing patterns and style.
3. Use the provided tools directly to inspect the workspace, create or modify files, and run commands.
4. Prefer clean, minimal, maintainable edits that fit naturally into the existing architecture.
5. If a file already exists, use `modify_file` or `patch_file` rather than attempting to recreate it.
6. When explaining or answering questions, be direct, thoughtful, and articulate.
7. After completing changes, provide a concise summary of what was accomplished and any next steps.

Current permission profile: {permission} ({explanation})"
    )
}

fn describe_call(call: &OllamaToolCall) -> String {
    let name = &call.function.name;
    // For comparison purposes, include just the tool name and key arg (path or command)
    let key = call.function.arguments.get("path")
        .or_else(|| call.function.arguments.get("command"))
        .and_then(|v| v.as_str())
        .unwrap_or("");
    format!("{name}({key})")
}

fn files_touched(call: &OllamaToolCall) -> Option<Vec<String>> {
    let path = call.function.arguments.get("path").and_then(|v| v.as_str());
    path.map(|p| vec![p.to_string()])
}

fn truncate(s: &str, max: usize) -> String {
    if s.len() > max {
        format!("{}... [TRUNCATED]", &s[..max])
    } else {
        s.to_string()
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Phase 5: Token estimation and context compaction
// ─────────────────────────────────────────────────────────────────────────────

/// Rough token count: chars / 4 is an acceptable approximation for v1.
fn estimate_tokens(messages: &[OllamaMessage]) -> usize {
    messages.iter().map(|m| {
        let content_len = m.content.as_deref().map(|c| c.len()).unwrap_or(0);
        let tool_calls_len = m.tool_calls.as_ref().map(|calls| {
            calls.iter().map(|c| c.function.name.len() + c.function.arguments.to_string().len()).sum::<usize>()
        }).unwrap_or(0);
        (content_len + tool_calls_len) / 4
    }).sum()
}

/// Compact older messages when approaching the context window limit.
/// Keeps: system prompt (index 0), last `keep_recent` tool exchanges intact.
/// Collapses everything in between into a single summary message.
fn compact_context(messages: &mut Vec<OllamaMessage>, objective: &str, context_window: usize) {
    let threshold = (context_window as f64 * CONTEXT_COMPACT_THRESHOLD) as usize;
    if estimate_tokens(messages) < threshold || messages.len() < 8 {
        return; // Not enough to compact
    }

    // Keep system prompt (index 0) and the last 6 messages (3 exchanges)
    let keep_recent = 6.min(messages.len().saturating_sub(2));
    let mut compact_end = messages.len() - keep_recent;
    if compact_end <= 1 {
        return; // Nothing to compact
    }

    // Safety: don't cut in the middle of an assistant tool_calls -> tool result exchange,
    // or the sliced-in region can leave an orphaned "tool" message with no matching
    // assistant tool_calls before it, which some models handle poorly. Walk `compact_end`
    // forward to the next message that starts a clean boundary: a "user" message, or an
    // "assistant" message that has no tool_calls (a plain reply, not a tool-call turn).
    while compact_end < messages.len() {
        let msg = &messages[compact_end];
        let is_safe_boundary = msg.role == "user"
            || (msg.role == "assistant" && msg.tool_calls.as_ref().map_or(true, |c| c.is_empty()));
        if is_safe_boundary {
            break;
        }
        compact_end += 1;
    }
    if compact_end <= 1 || compact_end >= messages.len() {
        return; // No safe boundary found in range — skip compaction this round rather than risk corrupting the transcript
    }

    // Build a compact summary of the older messages
    let mut summary_parts = Vec::new();
    summary_parts.push(format!("Objective: \"{objective}\""));
    summary_parts.push("Progress so far:".to_string());

    for msg in &messages[1..compact_end] {
        match msg.role.as_str() {
            "assistant" => {
                if let Some(calls) = &msg.tool_calls {
                    for call in calls {
                        let key = call.function.arguments.get("path")
                            .or_else(|| call.function.arguments.get("command"))
                            .and_then(|v| v.as_str())
                            .unwrap_or("?");
                        summary_parts.push(format!("- {}({})", call.function.name, key));
                    }
                }
            }
            "tool" => {
                if let Some(content) = &msg.content {
                    let status = if content.starts_with("Error") { "failed" } else { "ok" };
                    let preview = &content[..content.len().min(60)];
                    summary_parts.push(format!("  → {status}: {preview}"));
                }
            }
            _ => {} // skip user messages in the summary
        }
    }

    let summary = summary_parts.join("\n");

    // Replace the compacted region with a single summary message
    let system_msg = messages[0].clone();
    let recent: Vec<_> = messages[compact_end..].to_vec();
    messages.clear();
    messages.push(system_msg);
    messages.push(OllamaMessage::system(&format!("[Session context compacted]\n{summary}")));
    messages.extend(recent);
}

// ─────────────────────────────────────────────────────────────────────────────
// Phase 4: Behavioral checks
// ─────────────────────────────────────────────────────────────────────────────

/// Check if the final text contains success/completion language.
fn contains_success_language(text: &str) -> bool {
    let lower = text.to_lowercase();
    ["done", "fixed", "working", "successfully", "complete", "completed", "implemented", "created", "finished"]
        .iter()
        .any(|word| lower.contains(word))
}

/// Detect if the same tool call has failed 2+ times in the last 4 steps.
fn is_repeated_failure(plan_steps: &[PlanStep], call: &OllamaToolCall) -> bool {
    let desc = describe_call(call);
    let mut same_failed = 0;
    for step in plan_steps.iter().rev().take(4) {
        if step.status == "failed" && step.description == desc {
            same_failed += 1;
        }
    }
    same_failed >= 2
}

/// Check if the project directory is non-empty (has files).
fn project_has_files(project_path: &str) -> bool {
    if project_path.is_empty() { return false; }
    match std::fs::read_dir(project_path) {
        Ok(entries) => entries.into_iter().any(|e| e.is_ok()),
        Err(_) => false,
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Phase 8: Image validation
// ─────────────────────────────────────────────────────────────────────────────

const IMAGE_EXTENSIONS: &[&str] = &[".png", ".jpg", ".jpeg", ".webp", ".gif"];
const MAX_IMAGE_SIZE: u64 = 10 * 1024 * 1024; // 10MB

fn read_image_base64(path: &str) -> Result<String, String> {
    use base64::{Engine as _, engine::general_purpose::STANDARD};

    // Validate extension
    let lower_path = path.to_lowercase();
    if !IMAGE_EXTENSIONS.iter().any(|ext| lower_path.ends_with(ext)) {
        return Err(format!("Unsupported image format: {path}. Supported: png, jpg, jpeg, webp, gif"));
    }

    // Validate size
    let meta = std::fs::metadata(path).map_err(|e| format!("Cannot read image at {path}: {e}"))?;
    if meta.len() > MAX_IMAGE_SIZE {
        return Err(format!("Image too large ({} MB, max 10 MB): {path}", meta.len() / (1024 * 1024)));
    }

    let bytes = std::fs::read(path).map_err(|e| format!("Failed to read image at {path}: {e}"))?;
    Ok(STANDARD.encode(bytes))
}

// ─────────────────────────────────────────────────────────────────────────────
// Main agent loop
// ─────────────────────────────────────────────────────────────────────────────
#[derive(Debug, Clone, PartialEq)]
enum LoopState {
    Analyze,
    Plan,
    Edit,
    Build,
    Test,
    Fix,
    Review,
    PresentDiff,
    Done,
}

async fn stream_local_ollama(
    client: &OllamaClient,
    req: &OllamaChatRequest,
    app: &AppHandle,
    request_id: &str,
) -> Result<(String, Option<Vec<OllamaToolCall>>), String> {
    use futures_util::StreamExt;
    let mut req_clone = req.clone();
    let mut stream_result = client.chat_stream(&req_clone).await;
    if let Err(ref e) = stream_result {
        if e.contains("does not support tools") {
            req_clone.tools = None;
            stream_result = client.chat_stream(&req_clone).await;
        }
    }

    let mut stream = stream_result?;
    let mut accumulated_content = String::new();
    let mut final_tool_calls: Option<Vec<OllamaToolCall>> = None;

    while let Some(chunk) = stream.next().await {
        match chunk {
            Ok(resp) => {
                let done = resp.done.unwrap_or(false);
                if let Some(ref msg) = resp.message {
                    if let Some(ref delta) = msg.content {
                        accumulated_content.push_str(delta);
                        emit_agent_chat(app, request_id, delta, false);
                    }
                    if let Some(ref calls) = msg.tool_calls {
                        if !calls.is_empty() {
                            final_tool_calls = Some(calls.clone());
                        }
                    }
                }
                if done { break; }
            }
            Err(e) => return Err(e),
        }
    }

    Ok((accumulated_content, final_tool_calls))
}

async fn stream_cloud_chat(
    base_url: &str,
    api_key: &str,
    model: &str,
    messages: &[OllamaMessage],
    tools: Option<&[serde_json::Value]>,
    app: &AppHandle,
    request_id: &str,
) -> Result<(String, Option<Vec<OllamaToolCall>>), String> {
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(180))
        .build()
        .map_err(|e| e.to_string())?;

    let mut open_messages = Vec::new();
    for msg in messages {
        let role = msg.role.clone();
        let content = msg.content.clone().unwrap_or_default();
        if role == "tool" {
            open_messages.push(serde_json::json!({
                "role": "tool",
                "content": content,
                "tool_call_id": "call_1"
            }));
        } else {
            open_messages.push(serde_json::json!({
                "role": role,
                "content": content
            }));
        }
    }

    let url = if base_url.ends_with("/chat/completions") {
        base_url.to_string()
    } else {
        format!("{}/chat/completions", base_url.trim_end_matches('/'))
    };

    let mut candidate_models = vec![model.to_string()];
    // Only configure free fallbacks if the requested model is an openrouter auto free or free-tier model
    if url.contains("openrouter") && (model.ends_with(":free") || model == "openrouter/free") {
        for fallback in &[
            "meta-llama/llama-3.3-70b-instruct:free",
            "deepseek/deepseek-chat:free",
            "deepseek/deepseek-r1:free",
            "google/gemini-2.0-flash-exp:free",
            "meta-llama/llama-3.2-3b-instruct:free",
            "openrouter/free",
        ] {
            if *fallback != model {
                candidate_models.push(fallback.to_string());
            }
        }
    }

    let mut last_error = String::new();

    for (attempt_idx, current_target_model) in candidate_models.iter().enumerate() {
        let mut body = serde_json::json!({
            "model": current_target_model,
            "messages": open_messages,
            "stream": true,
            "temperature": 0.6
        });

        if let Some(t) = tools {
            if !t.is_empty() {
                body["tools"] = serde_json::Value::Array(t.to_vec());
            }
        }

        let mut req_builder = client.post(&url)
            .header("User-Agent", "Csotic-IDE/0.1.0")
            .header("Authorization", format!("Bearer {api_key}"))
            .header("Content-Type", "application/json");

        if url.contains("openrouter") {
            req_builder = req_builder
                .header("HTTP-Referer", "https://csotic.dev")
                .header("X-Title", "Csotic AI IDE");

            body["provider"] = serde_json::json!({
                "allow_fallbacks": true,
                "data_collection": "allow"
            });
        }

        let res = match req_builder.json(&body).send().await {
            Ok(r) => r,
            Err(e) => {
                last_error = e.to_string();
                continue;
            }
        };

        if !res.status().is_success() {
            let status = res.status();
            let err_text = res.text().await.unwrap_or_default();
            last_error = err_text.clone();

            if status.as_u16() == 401 {
                return Err("⚠️ Authentication failed (401): API key for this provider is invalid or expired. Please check Settings (⚙️).".to_string());
            }

            if status.as_u16() == 402 {
                return Err(format!("⚠️ Insufficient credits (402): Your account does not have enough credits for '{current_target_model}'. Please add credits on openrouter.ai or select a [FREE] model from the top bar."));
            }

            // Only retry with next free candidate on rate limits or service unavailable
            if (status.as_u16() == 429 || status.as_u16() == 503) && attempt_idx + 1 < candidate_models.len() {
                continue;
            }

            let clean_msg = if err_text.contains("harness") || status.as_u16() == 403 {
                format!("⚠️ Model '{}' is restricted by upstream provider.\n\n💡 Tip: Select **Meta LLaMA 3.3 70B [FREE]**, **DeepSeek [FREE]**, or **Google Gemini 2.0 Flash [FREE]** from the top bar for unrestricted access.", current_target_model)
            } else if err_text.contains("rate-limited") || err_text.contains("rate limit") || status.as_u16() == 429 {
                format!("⚠️ Model '{}' is temporarily rate-limited by upstream provider (429).\n\n💡 Tip: Select **Meta LLaMA 3.3 70B [FREE]**, **DeepSeek [FREE]**, or **Google Gemini 2.0 Flash [FREE]** from the top bar for reliable high-throughput responses.", current_target_model)
            } else {
                let clean_json_msg = serde_json::from_str::<serde_json::Value>(&err_text)
                    .ok()
                    .and_then(|parsed| {
                        parsed.get("error")
                            .and_then(|e| {
                                if let Some(msg) = e.get("message").and_then(|m| m.as_str()) {
                                    Some(msg.to_string())
                                } else if let Some(s) = e.as_str() {
                                    Some(s.to_string())
                                } else {
                                    None
                                }
                            })
                            .or_else(|| parsed.get("message").and_then(|m| m.as_str()).map(|s| s.to_string()))
                    })
                    .unwrap_or_else(|| err_text.clone());
                format!("⚠️ Cloud provider returned status {status}: {clean_json_msg}")
            };
            return Err(clean_msg);
        }

        // If we switched to a fallback model, notify the user
        if attempt_idx > 0 {
            emit_agent_chat(app, request_id, &format!("[Notice: '{}' was restricted or rate-limited upstream. Auto-routed to '{}']\n\n", model, current_target_model), false);
        }

        use futures_util::StreamExt;
        let mut stream = res.bytes_stream();
        let mut accumulated_content = String::new();
        let mut tool_calls_map: HashMap<usize, (String, String)> = HashMap::new();
        let mut buffer = String::new();

        while let Some(chunk) = stream.next().await {
            let bytes = chunk.map_err(|e| e.to_string())?;
            buffer.push_str(&String::from_utf8_lossy(&bytes));

            while let Some(pos) = buffer.find('\n') {
                let line = buffer[..pos].trim().to_string();
                buffer = buffer[pos + 1..].to_string();

                if line.is_empty() || line.starts_with(':') {
                    continue;
                }

                if let Some(data_str) = line.strip_prefix("data: ") {
                    let trimmed_data = data_str.trim();
                    if trimmed_data == "[DONE]" {
                        break;
                    }

                    if let Ok(val) = serde_json::from_str::<serde_json::Value>(trimmed_data) {
                        if let Some(choices) = val.get("choices").and_then(|v| v.as_array()) {
                            for choice in choices {
                                if let Some(delta) = choice.get("delta") {
                                    if let Some(text) = delta.get("content").and_then(|v| v.as_str()) {
                                        if !text.is_empty() {
                                            accumulated_content.push_str(text);
                                            emit_agent_chat(app, request_id, text, false);
                                        }
                                    }

                                    if let Some(tc_arr) = delta.get("tool_calls").and_then(|v| v.as_array()) {
                                        for tc in tc_arr {
                                            let idx = tc.get("index").and_then(|v| v.as_u64()).unwrap_or(0) as usize;
                                            let entry = tool_calls_map.entry(idx).or_insert_with(|| (String::new(), String::new()));
                                            if let Some(fn_obj) = tc.get("function") {
                                                if let Some(name) = fn_obj.get("name").and_then(|v| v.as_str()) {
                                                    entry.0.push_str(name);
                                                }
                                                if let Some(args) = fn_obj.get("arguments").and_then(|v| v.as_str()) {
                                                    entry.1.push_str(args);
                                                }
                                            }
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }

        let mut final_tool_calls = Vec::new();
        let mut indices: Vec<usize> = tool_calls_map.keys().cloned().collect();
        indices.sort();

        for idx in indices {
            if let Some((name, args_str)) = tool_calls_map.get(&idx) {
                if !name.trim().is_empty() {
                    let parsed_args = serde_json::from_str::<serde_json::Value>(args_str)
                        .unwrap_or_else(|_| serde_json::json!({}));
                    final_tool_calls.push(OllamaToolCall {
                        function: OllamaFunctionCall {
                            name: name.trim().to_string(),
                            arguments: parsed_args,
                        },
                    });
                }
            }
        }

        return Ok((accumulated_content, if final_tool_calls.is_empty() { None } else { Some(final_tool_calls) }));
    }

    Err(format!("Cloud request failed: {last_error}"))
}

fn finish_agent_task(
    app: &AppHandle,
    request_id: &str,
    project_id: Option<&str>,
    status: &str,
    changeset_state: crate::services::changeset::ChangeSetState,
    final_message: Option<&str>,
    objective: &str,
    plan_steps: &[PlanStep],
    elapsed: std::time::Duration,
) {
    if let Ok(conn) = app.state::<crate::AppState>().db.lock() {
        let now = chrono::Utc::now().to_rfc3339();
        let _ = conn.execute(
            "UPDATE ai_tasks SET status = ?1, updated_at = ?2, completed_at = ?2 WHERE id = ?3",
            rusqlite::params![status, now, request_id],
        );
    }
    let _ = crate::services::changeset::ChangeSetEngine::finalize_task_changeset(
        &app.state::<crate::AppState>().db,
        request_id,
        changeset_state,
    );
    let _ = crate::services::changeset::get_rollback_journal().persist_to_db(
        &app.state::<crate::AppState>().db,
        request_id,
        project_id,
    );

    if let Some(msg) = final_message {
        emit_agent_chat(app, request_id, msg, true);
    } else {
        emit_agent_chat(app, request_id, "", true);
    }
    emit_agent_state(app, status, objective, plan_steps, None, elapsed);
}

async fn run_agent_loop(
    app: AppHandle,
    request_id: String,
    objective: String,
    project_path: String,
    model_id: String,
    permission_profile: String,
    process_handle: terminal::ProcessHandle,
    image_paths: Vec<String>,
    history_messages: Vec<OllamaMessage>,
    cancel_flag: CancelFlag,
    shared_plan_steps: SharedPlanSteps,
    synthesis: crate::services::context::ContextSynthesis,
    intent: Option<String>,
    api_keys: HashMap<String, String>,
) {
    let start = Instant::now();

    // Small helper: push a step into both the local vec (used for in-loop logic,
    // e.g. is_repeated_failure) and the shared handle (used for cancel/timeout reporting).
    macro_rules! sync_plan_steps {
        ($local:expr) => {
            *shared_plan_steps.lock().await = $local.clone();
        };
    }
    let client = OllamaClient::new(None);

    let is_openrouter = crate::services::models::is_openrouter_model(&model_id);
    let is_openai = crate::services::models::is_openai_model(&model_id);
    let is_groq = crate::services::models::is_groq_model(&model_id);
    let is_deepseek = crate::services::models::is_deepseek_model(&model_id);
    let is_gemini = crate::services::models::is_gemini_model(&model_id);
    let is_anthropic = crate::services::models::is_anthropic_model(&model_id);
    let is_cloud = is_openrouter || is_openai || is_groq || is_deepseek || is_gemini || is_anthropic;

    // Get context window and vision support
    let (context_window, supports_vision) = if is_openrouter || is_anthropic {
        (200000usize, true)
    } else if is_gemini {
        (1000000usize, true)
    } else if is_openai {
        (128000usize, true)
    } else if is_groq {
        (128000usize, false)
    } else if is_deepseek {
        (64000usize, false)
    } else {
        match client.show(&model_id).await {
            Ok(show_resp) => {
                let ctx = show_resp.parameters.as_deref()
                    .and_then(|params| {
                        for line in params.lines() {
                            let line = line.trim();
                            if line.starts_with("num_ctx") {
                                return line.split_whitespace().last()
                                    .and_then(|v| v.parse::<usize>().ok());
                            }
                        }
                        None
                    })
                    .unwrap_or(DEFAULT_CONTEXT_WINDOW);

                let has_vision = show_resp.modelinfo.as_ref()
                    .map(|info| {
                        let info_str = info.to_string().to_lowercase();
                        info_str.contains("vision") || info_str.contains("llava") || info_str.contains("clip")
                    })
                    .unwrap_or(false)
                    || show_resp.details.as_ref()
                        .and_then(|d| d.family.as_deref())
                        .map(|f| f.to_lowercase().contains("llava") || f.to_lowercase().contains("clip"))
                        .unwrap_or(false);

                (ctx, has_vision)
            }
            Err(_) => (DEFAULT_CONTEXT_WINDOW, false),
        }
    };


    // Phase 8: Process images with validation
    let mut b64_images = Vec::new();
    let mut image_warnings = Vec::new();
    for path in &image_paths {
        match read_image_base64(path) {
            Ok(b64) => b64_images.push(b64),
            Err(e) => image_warnings.push(e),
        }
    }
    // Emit warnings for any dropped images
    for warning in &image_warnings {
        emit_agent_chat(&app, &request_id, &format!("⚠️ Image skipped: {warning}"), false);
    }

    let mut plan_steps: Vec<PlanStep> = vec![];

    if !b64_images.is_empty() && !supports_vision {
        emit_agent_chat(&app, &request_id, &format!("This model ({model_id}) doesn't support image input — attach a vision-capable model like `llava` or `qwen2.5vl` instead."), true);
        emit_agent_state(&app, "completed", &objective, &plan_steps, None, start.elapsed());
        return;
    }

    // Phase 2 (Behavior Spec §2): First-turn investigation nudge for substantive development tasks
    let obj_trimmed = objective.trim().to_lowercase();
    let is_casual = obj_trimmed.len() < 10 && ["yo", "hi", "hey", "hello", "what", "go head", "ok", "cool", "test", "sup"].iter().any(|g| obj_trimmed == *g);
    let investigation_hint = if project_has_files(&project_path) && !is_casual {
        "\n\n(Before making changes, take a moment to look at the relevant parts of the project \
        with list_dir/read_file if you haven't already — don't assume you know the current state.)"
    } else {
        ""
    };

    let mut context_injection = String::new();
    if project_has_files(&project_path) && !synthesis.ranked_files.is_empty() {
        context_injection.push_str("\n\n[Intelligent Context Engine - Relevant Project Files]\n");
        for file in &synthesis.ranked_files {
            if let Ok(content) = crate::services::filesystem::read_file_str(&project_path, &file.file_path) {
                let optimized = crate::services::context::ContextEngine::optimize_tokens(&content, &objective);
                context_injection.push_str(&format!("\n--- {} ---\n{}\n", file.file_path, optimized));
            }
        }
    }

    let user_content = format!("{}{}{}", objective, context_injection, investigation_hint);
    let user_msg = if !b64_images.is_empty() {
        OllamaMessage::user_with_images(&user_content, b64_images)
    } else {
        OllamaMessage::user(&user_content)
    };

    let mut messages = vec![
        OllamaMessage::system(&build_system_prompt(&project_path, &permission_profile, &synthesis, intent.as_deref())),
    ];
    messages.extend(history_messages);
    messages.push(user_msg);


    // Phase 4 counters: behavioral nudge caps (1 per run each)
    let mut verification_nudges_used: u32 = 0;
    let mut read_before_write_nudges_used: u32 = 0;

    let project_id = crate::services::filesystem::compute_project_id(&project_path);
    let mut project_state = crate::services::project_state::ProjectDetector::detect(&project_path);
    // read_tracker strictly tracks files explicitly read by the agent during THIS session.
    // It is deliberately NOT warm-seeded from disk/DB to strictly enforce read-before-modify.
    let read_tracker = std::sync::Arc::new(tokio::sync::Mutex::new(std::collections::HashMap::<String, String>::new()));

    crate::services::observability::log_action(&app.state::<crate::AppState>().db, &request_id, "SESSION_START", &format!("Objective: {}", objective));
    
    // Persist AI task into SQLite database
    let now_iso = chrono::Utc::now().to_rfc3339();
    if let Ok(conn) = app.state::<crate::AppState>().db.lock() {
        let _ = conn.execute(
            "INSERT OR REPLACE INTO ai_tasks (id, conversation_id, project_id, request, mode, status, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, 'running', ?6, ?7)",
            rusqlite::params![request_id, request_id, project_id, objective, permission_profile, now_iso, now_iso],
        );
        for (i, step) in plan_steps.iter().enumerate() {
            let step_id = format!("{}:{}", request_id, i);
            let _ = conn.execute(
                "INSERT OR REPLACE INTO task_steps (id, task_id, sequence, step_type, status, description, created_at)
                 VALUES (?1, ?2, ?3, 'action', ?4, ?5, ?6)",
                rusqlite::params![step_id, request_id, i as i64, step.status, step.description, now_iso],
            );
        }
    }

    let _ = crate::services::changeset::ChangeSetEngine::initialize_task_changeset(
        &app.state::<crate::AppState>().db,
        &request_id,
        Some(&project_id),
        &project_path,
        &objective,
    );

    // Phase 16: Objective-Driven Capability Detection & Anti-Duplication Enforcement
    if let Some(cap) = crate::services::context::ContextEngine::detect_existing_capability(
        &project_path,
        &objective,
        &app.state::<crate::AppState>().db,
        &project_id,
    ) {
        let sym_info = if !cap.key_symbols.is_empty() {
            format!("\nExported / Core Symbols: [{}]", cap.key_symbols.join(", "))
        } else {
            String::new()
        };

        messages.push(OllamaMessage::system(&format!(
            "[ARCHITECTURAL CONSTRAINT: EXISTING CAPABILITY DETECTED]\n\
            The project already contains an established implementation for '{}' located at:\n\
            - {}\
            {}\n\n\
            ⚠️ STRICT BACKEND ENFORCEMENT:\n\
            Do NOT create new parallel subsystems, alternative abstractions, or competing root files from scratch.\n\
            You MUST inspect and extend/modify the existing implementation files above to achieve the objective.\n\
            If the requested feature is already fully implemented, respond explaining that it is already present (NO-OP).",
            cap.domain,
            cap.primary_files.join("\n- "),
            sym_info
        )));
    }

    let mut current_state = LoopState::Analyze;
    let mut fix_retries: u32 = 0;
    let mut step_idx: u32 = 0;

    emit_agent_state(&app, "planning", &objective, &plan_steps, None, start.elapsed());

    while current_state != LoopState::Done && step_idx < MAX_STEPS {
        step_idx += 1;
        if cancel_flag.load(Ordering::SeqCst) {
            finish_agent_task(
                &app,
                &request_id,
                Some(&project_id),
                "cancelled",
                crate::services::changeset::ChangeSetState::RolledBack,
                Some("Cancelled. Here's what was completed before stopping — you can continue with a follow-up request."),
                &objective,
                &plan_steps,
                start.elapsed(),
            );
            sync_plan_steps!(plan_steps);
            return;
        }

        // Phase 5: Compact context if needed
        compact_context(&mut messages, &objective, context_window);

        // Phase 5: Filter tool availability based on intent natively
        let mut tools = crate::tools::tool_schemas(&permission_profile);

        // Phase 15: Dynamically inject plugin tools
        if let Ok(reg) = crate::services::plugins::REGISTRY.read() {
            tools.extend(reg.get_all_tools());
        }

        if let Some(i) = &intent {
            if i == "Research" || i == "Explain" || i == "Review" {
                tools.retain(|t| {
                    if let Some(name) = t.get("function").and_then(|f| f.get("name")).and_then(|n| n.as_str()) {
                        name == "read_file" || name == "list_dir" || name == "run_command"
                    } else {
                        false
                    }
                });
            }
        }

        let turn_result = if is_openrouter {
            let key = api_keys.get("openrouter")
                .filter(|k| !k.trim().is_empty())
                .ok_or_else(|| "OpenRouter API key is missing. Please open Settings (⚙️), enter your OpenRouter API key, and retry.".to_string());
            match key {
                Ok(k) => stream_cloud_chat("https://openrouter.ai/api/v1", k, &model_id, &messages, Some(&tools), &app, &request_id).await,
                Err(e) => Err(e),
            }
        } else if is_openai {
            let key = api_keys.get("openai")
                .filter(|k| !k.trim().is_empty())
                .ok_or_else(|| "OpenAI API key is missing. Please configure it in Settings (⚙️).".to_string());
            match key {
                Ok(k) => stream_cloud_chat("https://api.openai.com/v1", k, &model_id, &messages, Some(&tools), &app, &request_id).await,
                Err(e) => Err(e),
            }
        } else if is_anthropic {
            let key = api_keys.get("anthropic")
                .filter(|k| !k.trim().is_empty())
                .ok_or_else(|| "Anthropic API key is missing. Please configure it in Settings (⚙️).".to_string());
            match key {
                Ok(k) => stream_cloud_chat("https://api.anthropic.com/v1", k, &model_id, &messages, Some(&tools), &app, &request_id).await,
                Err(e) => Err(e),
            }
        } else if is_groq {
            let key = api_keys.get("groq")
                .filter(|k| !k.trim().is_empty())
                .ok_or_else(|| "Groq API key is missing. Please configure it in Settings (⚙️).".to_string());
            match key {
                Ok(k) => stream_cloud_chat("https://api.groq.com/openai/v1", k, &model_id, &messages, Some(&tools), &app, &request_id).await,
                Err(e) => Err(e),
            }
        } else if is_deepseek {
            let key = api_keys.get("deepseek")
                .filter(|k| !k.trim().is_empty())
                .ok_or_else(|| "DeepSeek API key is missing. Please configure it in Settings (⚙️).".to_string());
            match key {
                Ok(k) => stream_cloud_chat("https://api.deepseek.com", k, &model_id, &messages, Some(&tools), &app, &request_id).await,
                Err(e) => Err(e),
            }
        } else if is_gemini {
            let key = api_keys.get("gemini")
                .filter(|k| !k.trim().is_empty())
                .ok_or_else(|| "Google Gemini API key is missing. Please configure it in Settings (⚙️).".to_string());
            match key {
                Ok(k) => stream_cloud_chat("https://generativelanguage.googleapis.com/v1beta/openai", k, &model_id, &messages, Some(&tools), &app, &request_id).await,
                Err(e) => Err(e),
            }
        } else {
            let mut req = OllamaChatRequest {
                model: model_id.clone(),
                messages: messages.clone(),
                tools: Some(tools),
                options: Some(serde_json::json!({
                    "num_ctx": 16384,
                    "temperature": 0.6
                })),
                stream: true,
            };
            stream_local_ollama(&client, &req, &app, &request_id).await
        };

        let (accumulated_content, final_tool_calls) = match turn_result {
            Ok((acc, calls)) => (acc, calls),
            Err(e) => {
                finish_agent_task(
                    &app,
                    &request_id,
                    Some(&project_id),
                    "failed",
                    crate::services::changeset::ChangeSetState::RolledBack,
                    Some(&e),
                    &objective,
                    &plan_steps,
                    start.elapsed(),
                );
                sync_plan_steps!(plan_steps);
                return;
            }
        };

        // Build the assistant message from accumulated content
        let mut tool_calls = final_tool_calls.unwrap_or_default();

        // Fallback: extract tool calls from text if model didn't use native tool calling
        if tool_calls.is_empty() && !accumulated_content.is_empty() {
            tool_calls = extract_tool_calls_from_text(&accumulated_content);
        }

        if !tool_calls.is_empty() {
            // Phase 6 (Behavior Spec §6): Read-before-write nudge
            let has_prior_read = plan_steps.iter().any(|s| {
                s.description.starts_with("read_file") || s.description.starts_with("list_dir")
            });
            let first_call_is_write = tool_calls.first().map(|c| {
                matches!(
                    c.function.name.as_str(),
                    "create_file" | "modify_file" | "patch_file" | "replace_file" | "delete_file" | "move_file" | "copy_file"
                )
            }).unwrap_or(false);

            if !has_prior_read && first_call_is_write && read_before_write_nudges_used < 1 {
                read_before_write_nudges_used += 1;
                let target_path = tool_calls[0].function.arguments.get("path")
                    .and_then(|v| v.as_str())
                    .unwrap_or("the target file");
                // Add assistant message to preserve the conversation flow
                messages.push(OllamaMessage::assistant(&accumulated_content));
                messages.push(OllamaMessage::user(&format!(
                    "Before writing to {target_path}, take a look at the surrounding code first — check \
                    {target_path} itself if it already exists, or look at similar files in the same \
                    directory — so the new code matches the project's existing conventions."
                )));
                // Clear the streamed preview since we're re-prompting
                emit_agent_chat(&app, &request_id, "\n[Checking existing code first...]\n", false);
                continue;
            }

            // Add assistant message with tool calls to history
            let assistant_msg = OllamaMessage {
                role: "assistant".into(),
                content: if accumulated_content.is_empty() { None } else { Some(accumulated_content.clone()) },
                tool_calls: Some(tool_calls.clone()),
                images: None,
            };
            messages.push(assistant_msg);

            // Architectural Requirement 3: Turn-Level Batch ChangeSet Pre-Validation
            // Collect all mutating operations in this turn to validate the whole set before executing any single write
            let mut turn_mutations = Vec::new();
            for call in &tool_calls {
                if let Some(op) = parse_tool_call_to_operation(call) {
                    turn_mutations.push(op);
                }
            }

            if !turn_mutations.is_empty() {
                // Ensure project_state is fresh and reflects changes from earlier turns or manual edits
                project_state = crate::services::project_state::ProjectDetector::detect(&project_path);

                let batch_summary = crate::services::changeset::ChangeSetEngine::validate_turn_operations(
                    &project_state,
                    &request_id,
                    Some(&project_id),
                    &project_path,
                    &turn_mutations,
                );

                if !batch_summary.warnings.is_empty() {
                    crate::services::observability::log_action(
                        &app.state::<crate::AppState>().db,
                        &request_id,
                        "TURN_VALIDATION_WARNINGS",
                        &batch_summary.warnings.join("; "),
                    );
                }

                if !batch_summary.is_valid {
                    let err_msg = format!(
                        "BATCH_VALIDATION_FAILED: The proposed set of {} changes violated safety invariants:\n{}",
                        turn_mutations.len(),
                        batch_summary.errors.join("\n")
                    );
                    for call in &tool_calls {
                        messages.push(OllamaMessage::tool(&err_msg));
                        plan_steps.push(PlanStep {
                            description: describe_call(call),
                            status: "failed".into(),
                            files: files_touched(call),
                        });
                    }
                    emit_agent_chat(&app, &request_id, &format!("\n[Batch Safety Check Rejected: {}]\n", batch_summary.errors.join("; ")), false);
                    current_state = LoopState::Fix;
                    continue;
                }
            }

            for call in &tool_calls {
                if cancel_flag.load(Ordering::SeqCst) {
                    emit_agent_chat(&app, &request_id,
                        "Cancelled. Here's what was completed before stopping — you can continue with a follow-up request.",
                        true);
                    emit_agent_state(&app, "completed", &objective, &plan_steps, None, start.elapsed());
                    sync_plan_steps!(plan_steps);
                    return;
                }

                // Phase 5 (Behavior Spec §5): Repeated-failure detector
                if is_repeated_failure(&plan_steps, call) {
                    messages.push(OllamaMessage::tool(
                        "This exact command/edit has already failed twice. Try a different \
                        approach, or explain what's blocking you instead of repeating this."
                    ));
                    plan_steps.push(PlanStep {
                        description: describe_call(call),
                        status: "skipped".into(),
                        files: files_touched(call),
                    });
                    continue;
                }

                let step = PlanStep {
                    description: describe_call(call),
                    status: "running".into(),
                    files: files_touched(call),
                };
                plan_steps.push(step);
                let current_idx = plan_steps.len() - 1;
                emit_agent_state(&app, "executing", &objective, &plan_steps, Some(current_idx), start.elapsed());

                // Execute the tool
                let outcome = execute_agent_tool(
                    call,
                    &project_path,
                    Some(&project_id),
                    &permission_profile,
                    &process_handle,
                    &current_state,
                    &read_tracker,
                    &project_state,
                    &request_id,
                    step_idx as usize,
                    &app.state::<crate::AppState>().db,
                ).await;

                // Phase 14: Continuous Repository Intelligence
                if let Some(diff) = &outcome.file_diff {
                    crate::services::incremental::on_file_changed(&project_path, &diff.path, &diff.new_content, &app.state::<crate::AppState>().db);
                }

                // Update step status
                if let Some(step_ref) = plan_steps.get_mut(current_idx) {
                    step_ref.status = if outcome.success { "completed".into() } else { "failed".into() };
                }

                // Phase 4 & 7: State Machine Transitions
                let name = call.function.name.as_str();
                
                // Phase 12: Log the tool execution payload
                let payload_json = serde_json::to_string(&call.function.arguments).unwrap_or_default();
                crate::services::observability::log_action(&app.state::<crate::AppState>().db, &request_id, "TOOL_CALL", &format!("{}: {}", name, payload_json));

                let old_state = current_state.clone();

                if outcome.success {
                    fix_retries = 0; // Reset retries on success
                    if matches!(name, "create_file" | "modify_file" | "patch_file" | "replace_file" | "delete_file" | "move_file" | "copy_file" | "create_dir") {
                        current_state = LoopState::Edit;
                    } else if name == "run_command" {
                        current_state = LoopState::Test;
                    } else {
                        // If we were in Review state and used read tools, stay in Review or Plan
                        if current_state == LoopState::Review {
                            current_state = LoopState::Review;
                        } else {
                            current_state = LoopState::Plan;
                        }
                    }
                } else {
                    // Turn-Level Savepoint Compensation & State Synchronization
                    if matches!(name, "create_file" | "modify_file" | "patch_file" | "replace_file" | "delete_file" | "move_file" | "copy_file" | "create_dir") {
                        let rollback_res = crate::services::changeset::get_rollback_journal().rollback_turn(
                            &project_path,
                            &request_id,
                            step_idx as usize,
                            Some(&app.state::<crate::AppState>().db),
                        );

                        let reverted_summary = match rollback_res {
                            Ok(ref files) if !files.is_empty() => {
                                // Invalidate read_tracker cache for reverted files to force fresh reads
                                let mut rt = read_tracker.lock().await;
                                rt.clear();
                                format!("The following changes made during this turn (turn {}) were reverted to turn savepoint:\n- {}", step_idx, files.join("\n- "))
                            }
                            Ok(_) => "No partial filesystem changes had been applied in this turn.".to_string(),
                            Err(ref e) => format!("Rollback encountered conflicts:\n{}", e),
                        };

                        // Refresh project state
                        project_state = crate::services::project_state::ProjectDetector::detect(&project_path);

                        // Inject explicit system context to prevent LLM state divergence
                        messages.push(OllamaMessage::system(&format!(
                            "[ROLLBACK OCCURRED]\n\
                            {}\n\
                            ⚠️ CRITICAL CONTEXT SYNCHRONIZATION:\n\
                            Do NOT assume any prior file edits or creations from this failed turn exist on disk.\n\
                            The filesystem has been restored to the turn savepoint.\n\
                            You MUST call `read_file` or `list_dir` to inspect actual disk state before making further changes.",
                            reverted_summary
                        )));
                    }
                    current_state = LoopState::Fix;
                    fix_retries += 1;
                    if fix_retries > 3 {
                        current_state = LoopState::PresentDiff;
                        messages.push(OllamaMessage::system("Max retries for fixing this issue reached. Summarize current diff and exit."));
                    } else if name == "run_command" {
                        // Phase 8: Diagnostic Nudges
                        if fix_retries >= 2 {
                            messages.push(OllamaMessage::system(
                                "[DIAGNOSTIC AUTOMATION - DEEP DIVE]: You have failed to fix this issue multiple times. Do NOT guess the fix. You must use `read_file` to read the exact line of code causing the issue, or `list_dir` to check if files are missing, before you attempt to patch the code again."
                            ));
                        } else {
                            // Check for common error markers
                            let output = outcome.output.to_string();
                            let is_compile_err = output.contains("error[E") || output.contains("ERR!") || output.contains("FAIL");
                            let prefix = if is_compile_err { "[COMPILER/TEST FAILURE DIAGNOSTIC]\n" } else { "" };
                            
                            messages.push(OllamaMessage::system(
                                &format!("{}The command failed. Analyze the stderr output carefully. Identify the exact file path and line number of the failure, and output the correct tool call to patch the file.", prefix)
                            ));
                        }
                    }
                }

                // Phase 12: Log state shift
                if old_state != current_state {
                    crate::services::observability::log_action(&app.state::<crate::AppState>().db, &request_id, "STATE_SHIFT", &format!("{:?} -> {:?}", old_state, current_state));
                }

                // Phase 6: Include request_id in file-edited events
                if let Some(diff) = outcome.file_diff {
                    project_state = crate::services::project_state::ProjectDetector::detect(&project_path);
                    emit_file_edited(&app, &request_id, diff);
                }

                // Push tool result back
                messages.push(OllamaMessage::tool(
                    &truncate(&outcome.output, MAX_TOOL_OUTPUT_CHARS)
                ));
            }

            emit_agent_state(&app, "executing", &objective, &plan_steps, None, start.elapsed());
            sync_plan_steps!(plan_steps);
            continue;
        }

        // No tool calls => model produced its final answer
        current_state = LoopState::Done;

        finish_agent_task(
            &app,
            &request_id,
            Some(&project_id),
            "completed",
            crate::services::changeset::ChangeSetState::Applied,
            None,
            &objective,
            &plan_steps,
            start.elapsed(),
        );
        return;
    }

    // Step limit hit - persist task state as incomplete / partial
    finish_agent_task(
        &app,
        &request_id,
        Some(&project_id),
        "incomplete",
        crate::services::changeset::ChangeSetState::Partial,
        Some("I reached my step limit before fully verifying this task. Here's what I completed so far — you may want to continue with a follow-up request."),
        &objective,
        &plan_steps,
        start.elapsed(),
    );
}

struct ToolOutcome {
    success: bool,
    output: String,
    file_diff: Option<FileDiff>,
}

async fn execute_agent_tool(
    call: &OllamaToolCall,
    project_path: &str,
    project_id: Option<&str>,
    permission: &str,
    process_handle: &terminal::ProcessHandle,
    _current_state: &LoopState,
    read_tracker: &std::sync::Arc<tokio::sync::Mutex<std::collections::HashMap<String, String>>>,
    project_state: &crate::services::project_state::ProjectState,
    task_id: &str,
    turn_idx: usize,
    db: &std::sync::Mutex<rusqlite::Connection>,
) -> ToolOutcome {
    let name = call.function.name.as_str();
    let args = &call.function.arguments;

    let mutation_allowed = permission == "edit" || permission == "developer" || permission == "full_automation";
    let command_allowed = permission == "developer" || permission == "full_automation";

    match name {
        "read_project_state" => {
            let state = crate::services::project_state::ProjectDetector::detect(project_path);
            ToolOutcome {
                success: true,
                output: serde_json::to_string_pretty(&state).unwrap_or_else(|_| state.summary),
                file_diff: None,
            }
        }
        "read_file" => {
            let path = args.get("path").and_then(|v| v.as_str()).unwrap_or("");
            match filesystem::read_file_with_hash(project_path, path) {
                Ok((content, hash)) => {
                    let clean_path = path.trim().replace('\\', "/").trim_start_matches('/').to_string();
                    read_tracker.lock().await.insert(clean_path.clone(), hash.clone());
                    crate::services::changeset::get_rollback_journal().record_original(
                        task_id,
                        turn_idx,
                        &clean_path,
                        &hash,
                        Some(&content),
                        false,
                        Some(db),
                    );
                    ToolOutcome {
                        success: true,
                        output: format!("[File: {} | SHA-256: {}]\n{}", path, hash, content),
                        file_diff: None,
                    }
                }
                Err(e) => ToolOutcome { success: false, output: format!("Error: {e}"), file_diff: None },
            }
        }
        "create_file" => {
            if !mutation_allowed {
                return ToolOutcome { success: false, output: "Permission denied: read-only profile.".to_string(), file_diff: None };
            }
            let path = args.get("path").and_then(|v| v.as_str()).unwrap_or("");
            let content = args.get("content").and_then(|v| v.as_str()).unwrap_or("");
            let justification = args.get("justification").and_then(|v| v.as_str());

            // Pre-Creation Duplication Review Gate (Issue 38):
            // If semantic duplication or overlapping capability is found and no justification is provided:
            if justification.is_none() {
                if let Some((duplicate_of, reason)) = crate::services::project_state::ProjectDetector::find_semantic_duplication_with_content(project_state, path, Some(content)) {
                    return ToolOutcome {
                        success: false,
                        output: format!(
                            "DUPLICATION_REVIEW_REQUIRED: Existing implementation candidate '{}' was detected ({}).\n\
                            ⚠️ ANTI-DUPLICATION POLICY:\n\
                            Modifying or extending '{}' is strongly recommended instead of scaffolding a parallel file.\n\
                            If creating a separate file is strictly necessary, re-invoke `create_file` with a `justification` argument explaining why a new file is required.",
                            duplicate_of, reason, duplicate_of
                        ),
                        file_diff: None,
                    };
                }
            }

            let op = crate::services::changeset::ChangeOperation::Create {
                path: path.to_string(),
                content: content.to_string(),
            };
            match crate::services::changeset::ChangeSetEngine::execute_operation_transactional(
                project_path,
                project_state,
                task_id,
                turn_idx,
                project_id,
                db,
                read_tracker,
                op,
            ).await {
                Ok(outcome) => ToolOutcome {
                    success: outcome.success,
                    output: outcome.output_message,
                    file_diff: outcome.file_diff,
                },
                Err(e) => ToolOutcome { success: false, output: e, file_diff: None },
            }
        }
        "modify_file" => {
            if !mutation_allowed {
                return ToolOutcome { success: false, output: "Permission denied: read-only profile.".to_string(), file_diff: None };
            }
            let path = args.get("path").and_then(|v| v.as_str()).unwrap_or("");
            let content = args.get("content").and_then(|v| v.as_str()).unwrap_or("");
            let expected_hash = args.get("expected_hash").and_then(|v| v.as_str()).unwrap_or("");
            let op = crate::services::changeset::ChangeOperation::Modify {
                path: path.to_string(),
                expected_hash: expected_hash.to_string(),
                new_content: content.to_string(),
            };
            match crate::services::changeset::ChangeSetEngine::execute_operation_transactional(
                project_path,
                project_state,
                task_id,
                turn_idx,
                project_id,
                db,
                read_tracker,
                op,
            ).await {
                Ok(outcome) => ToolOutcome {
                    success: outcome.success,
                    output: outcome.output_message,
                    file_diff: outcome.file_diff,
                },
                Err(e) => ToolOutcome { success: false, output: e, file_diff: None },
            }
        }
        "patch_file" => {
            if !mutation_allowed {
                return ToolOutcome { success: false, output: "Permission denied: read-only profile.".to_string(), file_diff: None };
            }
            let path = args.get("path").and_then(|v| v.as_str()).unwrap_or("");
            let target = args.get("target").and_then(|v| v.as_str()).unwrap_or("");
            let replacement = args.get("replacement").and_then(|v| v.as_str()).unwrap_or("");
            let expected_hash = args.get("expected_hash").and_then(|v| v.as_str()).unwrap_or("");
            let op = crate::services::changeset::ChangeOperation::Patch {
                path: path.to_string(),
                expected_hash: expected_hash.to_string(),
                target: target.to_string(),
                replacement: replacement.to_string(),
            };
            match crate::services::changeset::ChangeSetEngine::execute_operation_transactional(
                project_path,
                project_state,
                task_id,
                turn_idx,
                project_id,
                db,
                read_tracker,
                op,
            ).await {
                Ok(outcome) => ToolOutcome {
                    success: outcome.success,
                    output: outcome.output_message,
                    file_diff: outcome.file_diff,
                },
                Err(e) => ToolOutcome { success: false, output: e, file_diff: None },
            }
        }
        "replace_file" => {
            if !mutation_allowed {
                return ToolOutcome { success: false, output: "Permission denied: read-only profile.".to_string(), file_diff: None };
            }
            let path = args.get("path").and_then(|v| v.as_str()).unwrap_or("");
            let content = args.get("content").and_then(|v| v.as_str()).unwrap_or("");
            let expected_hash = args.get("expected_hash").and_then(|v| v.as_str()).unwrap_or("");
            let op = crate::services::changeset::ChangeOperation::Replace {
                path: path.to_string(),
                expected_hash: expected_hash.to_string(),
                new_content: content.to_string(),
            };
            match crate::services::changeset::ChangeSetEngine::execute_operation_transactional(
                project_path,
                project_state,
                task_id,
                turn_idx,
                project_id,
                db,
                read_tracker,
                op,
            ).await {
                Ok(outcome) => ToolOutcome {
                    success: outcome.success,
                    output: outcome.output_message,
                    file_diff: outcome.file_diff,
                },
                Err(e) => ToolOutcome { success: false, output: e, file_diff: None },
            }
        }
        "delete_file" => {
            if !mutation_allowed {
                return ToolOutcome { success: false, output: "Permission denied: read-only profile.".to_string(), file_diff: None };
            }
            let path = args.get("path").and_then(|v| v.as_str()).unwrap_or("");
            let approved = args.get("approved").and_then(|v| v.as_bool()).unwrap_or(false);
            let op = crate::services::changeset::ChangeOperation::Delete {
                path: path.to_string(),
                approved,
            };
            match crate::services::changeset::ChangeSetEngine::execute_operation_transactional(
                project_path,
                project_state,
                task_id,
                turn_idx,
                project_id,
                db,
                read_tracker,
                op,
            ).await {
                Ok(outcome) => ToolOutcome {
                    success: outcome.success,
                    output: outcome.output_message,
                    file_diff: outcome.file_diff,
                },
                Err(e) => ToolOutcome { success: false, output: e, file_diff: None },
            }
        }
        "move_file" => {
            if !mutation_allowed {
                return ToolOutcome { success: false, output: "Permission denied: read-only profile.".to_string(), file_diff: None };
            }
            let source = args.get("source").and_then(|v| v.as_str()).unwrap_or("");
            let destination = args.get("destination").and_then(|v| v.as_str()).unwrap_or("");
            let op = crate::services::changeset::ChangeOperation::Move {
                source: source.to_string(),
                destination: destination.to_string(),
            };
            match crate::services::changeset::ChangeSetEngine::execute_operation_transactional(
                project_path,
                project_state,
                task_id,
                turn_idx,
                project_id,
                db,
                read_tracker,
                op,
            ).await {
                Ok(outcome) => ToolOutcome {
                    success: outcome.success,
                    output: outcome.output_message,
                    file_diff: outcome.file_diff,
                },
                Err(e) => ToolOutcome { success: false, output: e, file_diff: None },
            }
        }
        "copy_file" => {
            if !mutation_allowed {
                return ToolOutcome { success: false, output: "Permission denied: read-only profile.".to_string(), file_diff: None };
            }
            let source = args.get("source").and_then(|v| v.as_str()).unwrap_or("");
            let destination = args.get("destination").and_then(|v| v.as_str()).unwrap_or("");
            let op = crate::services::changeset::ChangeOperation::Copy {
                source: source.to_string(),
                destination: destination.to_string(),
            };
            match crate::services::changeset::ChangeSetEngine::execute_operation_transactional(
                project_path,
                project_state,
                task_id,
                turn_idx,
                project_id,
                db,
                read_tracker,
                op,
            ).await {
                Ok(outcome) => ToolOutcome {
                    success: outcome.success,
                    output: outcome.output_message,
                    file_diff: outcome.file_diff,
                },
                Err(e) => ToolOutcome { success: false, output: e, file_diff: None },
            }
        }
        "list_dir" => {
            let path = args.get("path").and_then(|v| v.as_str()).unwrap_or("");
            match filesystem::list_dir_str(project_path, path) {
                Ok(entries) => ToolOutcome { success: true, output: entries, file_diff: None },
                Err(e) => ToolOutcome { success: false, output: format!("Error: {e}"), file_diff: None },
            }
        }
        "create_dir" => {
            if !mutation_allowed {
                return ToolOutcome { success: false, output: "Permission denied: read-only profile.".to_string(), file_diff: None };
            }
            let path = args.get("path").and_then(|v| v.as_str()).unwrap_or("");
            let op = crate::services::changeset::ChangeOperation::CreateDirectory {
                path: path.to_string(),
            };
            match crate::services::changeset::ChangeSetEngine::execute_operation_transactional(
                project_path,
                project_state,
                task_id,
                turn_idx,
                project_id,
                db,
                read_tracker,
                op,
            ).await {
                Ok(outcome) => ToolOutcome {
                    success: outcome.success,
                    output: outcome.output_message,
                    file_diff: outcome.file_diff,
                },
                Err(e) => ToolOutcome { success: false, output: e, file_diff: None },
            }
        }
        "run_command" => {
            if !command_allowed {
                return ToolOutcome { success: false, output: "Permission denied: Developer permission is required to run commands.".to_string(), file_diff: None };
            }
            let command = args.get("command").and_then(|v| v.as_str()).unwrap_or("");
            match terminal::run_command_simple(project_path, command, permission, process_handle).await {
                Ok(out) => ToolOutcome { success: true, output: out, file_diff: None },
                Err(e) => ToolOutcome { success: false, output: format!("Error: {e}"), file_diff: None },
            }
        }
        _ => {
            if permission == "read_only" {
                return ToolOutcome { success: false, output: "Permission denied: plugin tools are disabled in read-only mode.".to_string(), file_diff: None };
            }
            // Fallback to Plugin Registry if it's a plugin tool
            if let Ok(reg) = crate::services::plugins::REGISTRY.read() {
                if let Some(res) = reg.execute_tool(name, args) {
                    match res {
                        Ok(output) => return ToolOutcome { success: true, output, file_diff: None },
                        Err(e) => return ToolOutcome { success: false, output: format!("Plugin Error: {e}"), file_diff: None },
                    }
                }
            }
            ToolOutcome { success: false, output: format!("Unknown tool: {name}"), file_diff: None }
        }
    }
}


// ─────────────────────────────────────────────────────────────────────────────
// Phase 9: Robust JSON tool call extraction with multiple strategies & aliases
// ─────────────────────────────────────────────────────────────────────────────

const KNOWN_VALID_TOOL_NAMES: &[&str] = &[
    "read_project_state",
    "read_file",
    "list_dir",
    "list_directory",
    "create_file",
    "modify_file",
    "patch_file",
    "replace_file",
    "delete_file",
    "move_file",
    "copy_file",
    "create_dir",
    "run_command",
    "execute_command",
    "git_status",
    "git_diff",
    "git_commit",
    "run_validation",
    "save_memory",
];

fn extract_tool_calls_from_text(content: &str) -> Vec<OllamaToolCall> {
    let mut calls = Vec::new();
    
    // Strategy 1: XML tags like <tool_call>, <forge_tool_call>, <forge-tool-call>, <function_call>
    let tags = [
        ("<forge_tool_call>", "</forge_tool_call>"),
        ("<forge-tool-call>", "</forge-tool-call>"),
        ("<tool_call>", "</tool_call>"),
        ("<function_call>", "</function_call>"),
        ("[TOOL_CALL]", "[/TOOL_CALL]"),
    ];

    for (open_tag, close_tag) in tags {
        let mut search_str = content;
        while let Some(start_idx) = search_str.find(open_tag) {
            let remainder = &search_str[start_idx + open_tag.len()..];
            if let Some(end_idx) = remainder.find(close_tag) {
                let json_text = remainder[..end_idx].trim();
                if let Ok(val) = serde_json::from_str::<serde_json::Value>(json_text) {
                    extract_calls_from_value(&val, &mut calls);
                }
                search_str = &remainder[end_idx + close_tag.len()..];
            } else {
                break;
            }
        }
        if !calls.is_empty() {
            return calls;
        }
    }

    // Strategy 2: Explicit ```tool_call, ```forge_tool_call, or ```function_call blocks
    let fences = [
        ("```tool_call", "```"),
        ("```forge_tool_call", "```"),
        ("```forge-tool-call", "```"),
        ("```function_call", "```"),
    ];

    for (open_fence, close_fence) in fences {
        let mut search_fences = content;
        while let Some(start_idx) = search_fences.find(open_fence) {
            let remainder = &search_fences[start_idx + open_fence.len()..];
            if let Some(end_idx) = remainder.find(close_fence) {
                let json_text = remainder[..end_idx].trim();
                if let Ok(val) = serde_json::from_str::<serde_json::Value>(json_text) {
                    extract_calls_from_value(&val, &mut calls);
                }
                search_fences = &remainder[end_idx + close_fence.len()..];
            } else {
                break;
            }
        }
        if !calls.is_empty() {
            return calls;
        }
    }

    // Strategy 3: Pure JSON response or full-message ```json block
    let trimmed = content.trim();
    let pure_json_str = if (trimmed.starts_with('{') && trimmed.ends_with('}')) || (trimmed.starts_with('[') && trimmed.ends_with(']')) {
        Some(trimmed)
    } else if trimmed.starts_with("```json") && trimmed.ends_with("```") {
        Some(trimmed.strip_prefix("```json").unwrap().strip_suffix("```").unwrap().trim())
    } else if trimmed.starts_with("```") && trimmed.ends_with("```") && !trimmed[3..].contains("```") {
        Some(trimmed.strip_prefix("```").unwrap().strip_suffix("```").unwrap().trim())
    } else {
        None
    };

    if let Some(json_text) = pure_json_str {
        if let Ok(val) = serde_json::from_str::<serde_json::Value>(json_text) {
            extract_calls_from_value(&val, &mut calls);
        }
    }

    calls
}

/// Helper to extract tool calls from a parsed JSON value (single object or array) with alias normalization
fn extract_calls_from_value(val: &serde_json::Value, calls: &mut Vec<OllamaToolCall>) {
    let process_single = |item: &serde_json::Value, calls_vec: &mut Vec<OllamaToolCall>| {
        // Handle function object nesting (e.g. {"function": {"name": "...", "arguments": ...}})
        let effective_obj = if let Some(fn_obj) = item.get("function") {
            fn_obj
        } else {
            item
        };

        if let Some(raw_name) = effective_obj.get("name").and_then(|n| n.as_str()) {
            if KNOWN_VALID_TOOL_NAMES.contains(&raw_name) {
                let canonical_name = match raw_name {
                    "list_directory" | "ls" => "list_dir",
                    "execute_command" | "terminal" | "shell" => "run_command",
                    other => other,
                };

                let raw_args = effective_obj.get("arguments")
                    .or_else(|| effective_obj.get("parameters"))
                    .or_else(|| effective_obj.get("input"));

                let parsed_args = match raw_args {
                    Some(serde_json::Value::String(s)) => {
                        serde_json::from_str(s).unwrap_or_else(|_| serde_json::json!({}))
                    }
                    Some(serde_json::Value::Object(o)) => serde_json::Value::Object(o.clone()),
                    _ => serde_json::json!({}),
                };

                calls_vec.push(OllamaToolCall {
                    function: OllamaFunctionCall {
                        name: canonical_name.to_string(),
                        arguments: parsed_args,
                    },
                });
            }
        }
    };

    if let Some(arr) = val.as_array() {
        for item in arr {
            process_single(item, calls);
        }
    } else {
        process_single(val, calls);
    }
}

fn parse_tool_call_to_operation(call: &OllamaToolCall) -> Option<crate::services::changeset::ChangeOperation> {
    let name = call.function.name.as_str();
    let args = &call.function.arguments;

    match name {
        "create_file" => {
            let path = args.get("path").and_then(|v| v.as_str()).unwrap_or("");
            let content = args.get("content").and_then(|v| v.as_str()).unwrap_or("");
            Some(crate::services::changeset::ChangeOperation::Create {
                path: path.to_string(),
                content: content.to_string(),
            })
        }
        "modify_file" => {
            let path = args.get("path").and_then(|v| v.as_str()).unwrap_or("");
            let content = args.get("content").and_then(|v| v.as_str()).unwrap_or("");
            let expected_hash = args.get("expected_hash").and_then(|v| v.as_str()).unwrap_or("");
            Some(crate::services::changeset::ChangeOperation::Modify {
                path: path.to_string(),
                expected_hash: expected_hash.to_string(),
                new_content: content.to_string(),
            })
        }
        "patch_file" => {
            let path = args.get("path").and_then(|v| v.as_str()).unwrap_or("");
            let target = args.get("target").and_then(|v| v.as_str()).unwrap_or("");
            let replacement = args.get("replacement").and_then(|v| v.as_str()).unwrap_or("");
            let expected_hash = args.get("expected_hash").and_then(|v| v.as_str()).unwrap_or("");
            Some(crate::services::changeset::ChangeOperation::Patch {
                path: path.to_string(),
                expected_hash: expected_hash.to_string(),
                target: target.to_string(),
                replacement: replacement.to_string(),
            })
        }
        "replace_file" => {
            let path = args.get("path").and_then(|v| v.as_str()).unwrap_or("");
            let content = args.get("content").and_then(|v| v.as_str()).unwrap_or("");
            let expected_hash = args.get("expected_hash").and_then(|v| v.as_str()).unwrap_or("");
            Some(crate::services::changeset::ChangeOperation::Replace {
                path: path.to_string(),
                expected_hash: expected_hash.to_string(),
                new_content: content.to_string(),
            })
        }
        "delete_file" => {
            let path = args.get("path").and_then(|v| v.as_str()).unwrap_or("");
            let approved = args.get("approved").and_then(|v| v.as_bool()).unwrap_or(false);
            Some(crate::services::changeset::ChangeOperation::Delete {
                path: path.to_string(),
                approved,
            })
        }
        "move_file" => {
            let source = args.get("source").and_then(|v| v.as_str()).unwrap_or("");
            let destination = args.get("destination").and_then(|v| v.as_str()).unwrap_or("");
            Some(crate::services::changeset::ChangeOperation::Move {
                source: source.to_string(),
                destination: destination.to_string(),
            })
        }
        "copy_file" => {
            let source = args.get("source").and_then(|v| v.as_str()).unwrap_or("");
            let destination = args.get("destination").and_then(|v| v.as_str()).unwrap_or("");
            Some(crate::services::changeset::ChangeOperation::Copy {
                source: source.to_string(),
                destination: destination.to_string(),
            })
        }
        "create_dir" => {
            let path = args.get("path").and_then(|v| v.as_str()).unwrap_or("");
            Some(crate::services::changeset::ChangeOperation::CreateDirectory {
                path: path.to_string(),
            })
        }
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_intent_tool_filtering() {
        let mut tools = vec![
            serde_json::json!({ "function": { "name": "read_file" } }),
            serde_json::json!({ "function": { "name": "modify_file" } }),
            serde_json::json!({ "function": { "name": "patch_file" } }),
            serde_json::json!({ "function": { "name": "run_command" } }),
        ];

        let intent = Some("Research".to_string());

        if let Some(i) = &intent {
            if i == "Research" || i == "Explain" || i == "Review" {
                tools.retain(|t| {
                    if let Some(name) = t.get("function").and_then(|f| f.get("name")).and_then(|n| n.as_str()) {
                        name == "read_file" || name == "list_dir" || name == "run_command"
                    } else {
                        false
                    }
                });
            }
        }

        assert_eq!(tools.len(), 2);
        let names: Vec<&str> = tools.iter()
            .map(|t| t.get("function").unwrap().get("name").unwrap().as_str().unwrap())
            .collect();
        
        assert!(names.contains(&"read_file"));
        assert!(names.contains(&"run_command"));
        assert!(!names.contains(&"modify_file"));
        assert!(!names.contains(&"patch_file"));
    }

    #[test]
    fn test_strict_tool_call_extraction() {
        // 1. Explicit <tool_call> tag should succeed
        let tag_input = r#"Here is the plan: <tool_call>{"name": "create_file", "arguments": {"path": "test.ts", "content": "console.log(1);"}}</tool_call>"#;
        let calls = extract_tool_calls_from_text(tag_input);
        assert_eq!(calls.len(), 1);
        assert_eq!(calls[0].function.name, "create_file");

        // 2. Explanatory markdown with random json example should NOT be executed
        let explanation_input = "To create a file you could do:\n```json\n{\n  \"name\": \"create_file\",\n  \"arguments\": {\"path\": \"example.ts\"}\n}\n```\nHope this helps!";
        let false_calls = extract_tool_calls_from_text(explanation_input);
        assert_eq!(false_calls.len(), 0);

        // 3. Raw JSON object (whole response) should succeed
        let raw_json_input = r#"{"name": "read_file", "arguments": {"path": "src/main.rs"}}"#;
        let raw_calls = extract_tool_calls_from_text(raw_json_input);
        assert_eq!(raw_calls.len(), 1);
        assert_eq!(raw_calls[0].function.name, "read_file");

        // 4. Invalid/unknown tool name should be rejected
        let invalid_tool_input = r#"<tool_call>{"name": "delete_hard_drive", "arguments": {}}</tool_call>"#;
        let invalid_calls = extract_tool_calls_from_text(invalid_tool_input);
        assert_eq!(invalid_calls.len(), 0);
    }
}
