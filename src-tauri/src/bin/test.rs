use serde_json::json;

fn main() {
    let payload = json!({
        "active_model": "qwen2.5-coder:7b",
        "background_model": "gpt-4o"
    });

    if let Some(active_model) = payload.get("active_model") {
        let val = active_model.as_str().map(|s| s.to_string());
        println!("active_model: {:?}", val);
    }
}
