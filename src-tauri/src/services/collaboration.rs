pub fn handle(action: &str, payload: &serde_json::Value) -> Result<serde_json::Value, String> {
    match action {
        "start_session" => {
            let session_id = uuid::Uuid::new_v4().to_string();
            Ok(serde_json::json!({ "session_id": session_id }))
        }
        "join_session" => {
            let _session_id = payload
                .get("session_id")
                .and_then(|v| v.as_str())
                .ok_or("Missing 'session_id'")?;
            Ok(serde_json::json!({ "joined": true }))
        }
        _ => Err(format!("Unknown collaboration action: {action}")),
    }
}
