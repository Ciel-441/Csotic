use crate::agents::{AgentContext, AgentResult, AgentRole, PlannerAgent, CodingAgent, ReviewAgent};
use serde_json::Value;

pub async fn dispatch_task(role: AgentRole, context: AgentContext) -> Result<AgentResult, String> {
    match role {
        AgentRole::Planner => PlannerAgent::execute(&context).await,
        AgentRole::Coding => CodingAgent::execute(&context).await,
        AgentRole::Review => ReviewAgent::execute(&context).await,
        _ => Err("Agent role not fully implemented yet".to_string())
    }
}

pub async fn handle(action: &str, payload: &Value) -> Result<Value, String> {
    match action {
        "dispatch" => {
            let role_str = payload.get("role").and_then(|v| v.as_str()).ok_or("Missing role")?;
            let role = match role_str {
                "planner" => AgentRole::Planner,
                "coding" => AgentRole::Coding,
                "review" => AgentRole::Review,
                _ => return Err("Invalid role".to_string()),
            };
            
            let context: AgentContext = serde_json::from_value(
                payload.get("context").cloned().unwrap_or(serde_json::json!({
                    "project_path": "",
                    "instruction": ""
                }))
            ).map_err(|e| format!("Invalid context payload: {}", e))?;
            
            let result = dispatch_task(role, context).await?;
            serde_json::to_value(result).map_err(|e| e.to_string())
        }
        _ => Err(format!("Unknown action: {}", action))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn test_orchestrator_dispatch() {
        let context = AgentContext {
            project_path: "/test".to_string(),
            instruction: "test instruction".to_string(),
        };

        let result = dispatch_task(AgentRole::Planner, context.clone()).await.unwrap();
        assert!(result.success);
        assert_eq!(result.next_action.unwrap(), "Code");

        let result = dispatch_task(AgentRole::Coding, context.clone()).await.unwrap();
        assert!(result.success);
        assert_eq!(result.next_action.unwrap(), "Review");
    }
}
