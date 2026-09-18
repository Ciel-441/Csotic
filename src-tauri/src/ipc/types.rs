use serde::{Deserialize, Serialize};
use uuid::Uuid;

/// Every IPC request follows this structure per Chapter 3 §IPC Layer.
/// Contains: request_id, service, action, payload, timestamp.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct IpcRequest {
    pub request_id: String,
    pub service: String,
    pub action: String,
    pub payload: serde_json::Value,
    pub timestamp: String,
}

/// Every IPC response follows this structure per Chapter 3 §IPC Layer.
/// Contains: success, data, error, duration_ms.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct IpcResponse {
    pub success: bool,
    pub data: serde_json::Value,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<IpcError>,
    pub duration_ms: u64,
}

/// Typed, machine-readable errors per Chapter 8 §Error Model.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct IpcError {
    pub code: ErrorCode,
    pub message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub details: Option<String>,
}

/// Error categories from Chapter 8: Validation, Permission, Filesystem,
/// Process, Network, Model, Internal.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum ErrorCode {
    Validation,
    Permission,
    Filesystem,
    Process,
    Network,
    Model,
    Internal,
}

/// Tool execution result per Chapter 5 §Tool Contract.
/// Every tool returns: success, output, artifacts, duration_ms, warnings, errors.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ToolResult {
    pub success: bool,
    pub output: serde_json::Value,
    pub artifacts: Vec<String>,
    pub duration_ms: u64,
    pub warnings: Vec<String>,
    pub errors: Vec<String>,
}

/// Risk levels for the Permission Engine per Chapter 5 §Permission Engine.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum RiskLevel {
    Low,
    Medium,
    High,
    Critical,
}

/// Agent intent categories per Chapter 4 §Intent Analysis.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum AgentIntent {
    Generate,
    Explain,
    Refactor,
    Debug,
    Review,
    Test,
    Research,
    Document,
    Configure,
}

/// Intent analysis output per Chapter 4 §Intent Analysis.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct IntentAnalysis {
    pub intent: AgentIntent,
    pub confidence: f64,
    pub estimated_scope: String,
    pub required_tools: Vec<String>,
    pub risk_level: RiskLevel,
}

impl IpcRequest {
    pub fn new(service: &str, action: &str, payload: serde_json::Value) -> Self {
        Self {
            request_id: Uuid::new_v4().to_string(),
            service: service.to_string(),
            action: action.to_string(),
            payload,
            timestamp: chrono::Utc::now().to_rfc3339(),
        }
    }
}

impl IpcResponse {
    pub fn success(data: serde_json::Value, duration_ms: u64) -> Self {
        Self {
            success: true,
            data,
            error: None,
            duration_ms,
        }
    }

    pub fn error(code: ErrorCode, message: &str, duration_ms: u64) -> Self {
        Self {
            success: false,
            data: serde_json::Value::Null,
            error: Some(IpcError {
                code,
                message: message.to_string(),
                details: None,
            }),
            duration_ms,
        }
    }
}
