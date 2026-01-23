use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::parsers::{ParsedResponse, ToolCall, Usage};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ObservabilityEvent {
    pub seq: Option<i64>,
    pub id: Uuid,
    pub timestamp: DateTime<Utc>,
    pub session_id: Option<String>,
    pub agent: Option<String>,
    pub payload: Payload,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum Payload {
    UserMessage(UserMessage),
    AssistantResponse(AssistantResponse),
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UserMessage {
    pub model: Option<String>,
    pub text: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AssistantResponse {
    pub streaming: bool,
    pub model: Option<String>,
    pub message_id: Option<String>,
    pub stop_reason: Option<String>,
    pub thinking: Option<String>,
    pub text: Option<String>,
    pub tool_calls: Vec<ToolCall>,
    pub usage: Option<Usage>,
}

impl From<ParsedResponse> for AssistantResponse {
    fn from(parsed: ParsedResponse) -> Self {
        Self {
            streaming: parsed.streaming,
            model: parsed.metadata.model,
            message_id: parsed.metadata.message_id,
            stop_reason: parsed.metadata.stop_reason,
            thinking: parsed.thinking,
            text: parsed.text,
            tool_calls: parsed.tool_calls,
            usage: parsed.usage,
        }
    }
}
