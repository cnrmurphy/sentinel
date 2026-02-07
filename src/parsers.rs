//! Response parsers for different LLM providers.
//!
//! This module provides a trait-based abstraction for parsing LLM responses,
//! allowing provider-specific implementations while keeping the proxy generic.

use serde::{Deserialize, Serialize};

#[derive(Debug, Deserialize)]
pub struct AnthropicRequest {
    pub model: String,
    pub messages: Vec<Message>,
    #[serde(default)]
    pub system: Option<SystemContent>,
    #[serde(default)]
    pub metadata: Option<RequestMetadata>,
}

#[derive(Debug, Deserialize)]
pub struct Message {
    pub role: String,
    pub content: MessageContent,
}

#[derive(Debug, Deserialize)]
#[serde(untagged)]
pub enum MessageContent {
    Text(String),
    Blocks(Vec<ContentBlock>),
}

#[derive(Debug, Deserialize)]
#[serde(untagged)]
pub enum SystemContent {
    Text(String),
    Blocks(Vec<ContentBlock>),
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum ContentBlock {
    Text { text: String },
    Thinking { thinking: String },
    ToolUse { id: String, name: String, input: serde_json::Value },
    ToolResult { tool_use_id: String, content: serde_json::Value },
}

#[derive(Debug, Deserialize)]
pub struct RequestMetadata {
    pub user_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct ResponseMetadata {
    pub model: Option<String>,
    pub message_id: Option<String>,
    pub stop_reason: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum SseEvent {
    MessageStart { message: SseMessageStart },
    ContentBlockStart { index: usize, content_block: SseContentBlock },
    ContentBlockDelta { index: usize, delta: SseDelta },
    ContentBlockStop { index: usize },
    MessageDelta { delta: SseMessageDelta, usage: Option<Usage> },
    MessageStop,
    Ping,
}

#[derive(Debug, Deserialize)]
pub struct SseMessageStart {
    pub id: String,
    pub model: String,
}

#[derive(Debug, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum SseContentBlock {
    Text { text: String },
    #[serde(rename_all = "snake_case")]
    Thinking {
        thinking: String,
        #[serde(default)]
        signature: String,
    },
    ToolUse {
        id: String,
        name: String,
        #[serde(default)]
        input: serde_json::Value,
    },
}

#[derive(Debug, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum SseDelta {
    TextDelta { text: String },
    ThinkingDelta { thinking: String },
    InputJsonDelta { partial_json: String },
    SignatureDelta { signature: String },
}

#[derive(Debug, Deserialize)]
pub struct SseMessageDelta {
    pub stop_reason: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct AnthropicResponse {
    pub id: String,
    pub model: String,
    pub content: Vec<ContentBlock>,
    pub stop_reason: Option<String>,
    pub usage: Option<Usage>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct ParsedResponse {
    pub thinking: Option<String>,
    pub text: Option<String>,
    pub tool_calls: Vec<ToolCall>,
    pub usage: Option<Usage>,
    pub streaming: bool,
    pub metadata: ResponseMetadata,
    pub is_topic_event: bool,
    pub topic: Option<String>,
}

#[derive(Debug, Deserialize)]
struct TopicInfo {
    #[serde(rename = "isNewTopic")]
    is_new_topic: bool,
    title: Option<String>,
}

fn parse_topic(text: &Option<String>) -> (bool, Option<String>) {
    let Some(text) = text.as_ref() else { return (false, None) };
    let Ok(info) = serde_json::from_str::<TopicInfo>(text.trim()) else { return (false, None) };
    let title = if info.is_new_topic { info.title } else { None };
    (true, title)
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ToolCall {
    pub id: String,
    pub name: String,
    pub input: serde_json::Value,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Usage {
    pub input_tokens: Option<i64>,
    pub output_tokens: Option<i64>,
    #[serde(alias = "cache_read_input_tokens")]
    pub cache_read_tokens: Option<i64>,
    #[serde(alias = "cache_creation_input_tokens")]
    pub cache_creation_tokens: Option<i64>,
}

/// Trait for parsing LLM responses from different providers.
pub trait ResponseParser: Send + Sync {
    /// Parse a streaming response (SSE format)
    fn parse_streaming(&self, raw: &str) -> ParsedResponse;

    /// Parse a non-streaming JSON response
    fn parse_json(&self, json: &serde_json::Value) -> ParsedResponse;

    /// Provider name for identification
    fn provider(&self) -> &'static str;
}

/// Anthropic API response parser
pub struct AnthropicParser;

impl AnthropicParser {
    pub fn new() -> Self {
        Self
    }

    fn parse_sse_events(&self, raw: &str) -> ParsedResponse {
        let mut thinking = String::new();
        let mut text = String::new();
        let mut tool_calls = Vec::new();
        let mut usage = None;
        let mut metadata = ResponseMetadata::default();

        let mut current_tool_id: Option<String> = None;
        let mut current_tool_name: Option<String> = None;
        let mut current_tool_input = String::new();

        for line in raw.lines() {
            let Some(data) = line.strip_prefix("data: ") else { continue };
            let Ok(event) = serde_json::from_str::<SseEvent>(data) else { continue };

            match event {
                SseEvent::MessageStart { message } => {
                    metadata.model = Some(message.model);
                    metadata.message_id = Some(message.id);
                }
                SseEvent::ContentBlockStart { content_block, .. } => {
                    if let SseContentBlock::ToolUse { id, name, .. } = content_block {
                        current_tool_id = Some(id);
                        current_tool_name = Some(name);
                        current_tool_input.clear();
                    }
                }
                SseEvent::ContentBlockDelta { delta, .. } => match delta {
                    SseDelta::ThinkingDelta { thinking: t } => thinking.push_str(&t),
                    SseDelta::TextDelta { text: t } => text.push_str(&t),
                    SseDelta::InputJsonDelta { partial_json } => current_tool_input.push_str(&partial_json),
                    SseDelta::SignatureDelta { .. } => {}
                },
                SseEvent::ContentBlockStop { .. } => {
                    if let (Some(id), Some(name)) = (current_tool_id.take(), current_tool_name.take()) {
                        let input = serde_json::from_str(&current_tool_input).unwrap_or_default();
                        tool_calls.push(ToolCall { id, name, input });
                        current_tool_input.clear();
                    }
                }
                SseEvent::MessageDelta { delta, usage: u } => {
                    metadata.stop_reason = delta.stop_reason;
                    usage = u;
                }
                SseEvent::MessageStop | SseEvent::Ping => {}
            }
        }

        let text = if text.is_empty() { None } else { Some(text) };
        let (is_topic_event, topic) = parse_topic(&text);

        ParsedResponse {
            thinking: if thinking.is_empty() { None } else { Some(thinking) },
            text,
            tool_calls,
            usage,
            streaming: true,
            metadata,
            is_topic_event,
            topic,
        }
    }
}

impl Default for AnthropicParser {
    fn default() -> Self {
        Self::new()
    }
}

impl ResponseParser for AnthropicParser {
    fn parse_streaming(&self, raw: &str) -> ParsedResponse {
        self.parse_sse_events(raw)
    }

    fn parse_json(&self, json: &serde_json::Value) -> ParsedResponse {
        let Ok(response) = serde_json::from_value::<AnthropicResponse>(json.clone()) else {
            return ParsedResponse::default();
        };

        let mut thinking = None;
        let mut text = None;
        let mut tool_calls = Vec::new();

        for block in response.content {
            match block {
                ContentBlock::Thinking { thinking: t } => thinking = Some(t),
                ContentBlock::Text { text: t } => text = Some(t),
                ContentBlock::ToolUse { id, name, input } => {
                    tool_calls.push(ToolCall { id, name, input });
                }
                ContentBlock::ToolResult { .. } => {}
            }
        }

        let (is_topic_event, topic) = parse_topic(&text);

        ParsedResponse {
            thinking,
            text,
            tool_calls,
            usage: response.usage,
            streaming: false,
            is_topic_event,
            metadata: ResponseMetadata {
                model: Some(response.model),
                message_id: Some(response.id),
                stop_reason: response.stop_reason,
            },
            topic,
        }
    }

    fn provider(&self) -> &'static str {
        "anthropic"
    }
}

impl AnthropicRequest {
    pub fn last_user_message_text(&self) -> Option<String> {
        let user_msg = self.messages.iter().rev().find(|m| m.role == "user")?;
        Some(user_msg.content.text())
    }
}

impl MessageContent {
    pub fn text(&self) -> String {
        match self {
            MessageContent::Text(s) => s.clone(),
            MessageContent::Blocks(blocks) => {
                let mut result = String::new();
                for block in blocks {
                    if let ContentBlock::Text { text } = block {
                        if !result.is_empty() {
                            result.push('\n');
                        }
                        result.push_str(text);
                    }
                }
                result
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_streaming_text() {
        let parser = AnthropicParser::new();
        let sse = r#"event: message_start
data: {"type":"message_start","message":{"model":"claude-3","id":"msg_123"}}

event: content_block_delta
data: {"type":"content_block_delta","delta":{"type":"text_delta","text":"Hello"}}

event: content_block_delta
data: {"type":"content_block_delta","delta":{"type":"text_delta","text":" world"}}

event: message_stop
data: {"type":"message_stop"}
"#;

        let parsed = parser.parse_streaming(sse);
        assert_eq!(parsed.text, Some("Hello world".to_string()));
        assert!(parsed.streaming);
    }

    #[test]
    fn test_parse_topic_new() {
        let text = Some(r#"{"isNewTopic": true, "title": "Fix auth bug"}"#.to_string());
        let (is_topic, title) = parse_topic(&text);
        assert!(is_topic);
        assert_eq!(title, Some("Fix auth bug".to_string()));
    }

    #[test]
    fn test_parse_topic_not_new() {
        let text = Some(r#"{"isNewTopic": false, "title": null}"#.to_string());
        let (is_topic, title) = parse_topic(&text);
        assert!(is_topic);
        assert_eq!(title, None);
    }

    #[test]
    fn test_parse_topic_normal_response() {
        let text = Some("Here's how to fix the auth bug...".to_string());
        let (is_topic, title) = parse_topic(&text);
        assert!(!is_topic);
        assert_eq!(title, None);
    }

    #[test]
    fn test_parse_topic_none() {
        let (is_topic, title) = parse_topic(&None);
        assert!(!is_topic);
        assert_eq!(title, None);
    }

    #[test]
    fn test_parse_streaming_thinking() {
        let parser = AnthropicParser::new();
        let sse = r#"data: {"type":"content_block_delta","delta":{"type":"thinking_delta","thinking":"Let me think"}}
data: {"type":"content_block_delta","delta":{"type":"thinking_delta","thinking":"..."}}
data: {"type":"content_block_delta","delta":{"type":"text_delta","text":"Answer"}}
"#;

        let parsed = parser.parse_streaming(sse);
        assert_eq!(parsed.thinking, Some("Let me think...".to_string()));
        assert_eq!(parsed.text, Some("Answer".to_string()));
    }
}
