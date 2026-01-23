//! Response parsers for different LLM providers.
//!
//! This module provides a trait-based abstraction for parsing LLM responses,
//! allowing provider-specific implementations while keeping the proxy generic.

use serde::{Deserialize, Serialize};

/// Parsed response from an LLM, normalized across providers.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct ParsedResponse {
    /// The model's thinking/reasoning (if available)
    pub thinking: Option<String>,
    /// The final text response
    pub text: Option<String>,
    /// Tool calls made by the model
    pub tool_calls: Vec<ToolCall>,
    /// Token usage statistics
    pub usage: Option<Usage>,
    /// The raw response data (for debugging/archival)
    pub raw: String,
    /// Whether this was a streaming response
    pub streaming: bool,
    /// Provider-specific metadata
    pub metadata: serde_json::Value,
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
    pub cache_read_tokens: Option<i64>,
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

    /// Parse SSE events from Anthropic's streaming format
    fn parse_sse_events(&self, raw: &str) -> ParsedResponse {
        let mut thinking = String::new();
        let mut text = String::new();
        let mut tool_calls = Vec::new();
        let mut usage = None;
        let mut metadata = serde_json::json!({});

        // Track current tool being built
        let mut current_tool_id: Option<String> = None;
        let mut current_tool_name: Option<String> = None;
        let mut current_tool_input = String::new();

        for line in raw.lines() {
            // SSE format: "data: {json}"
            if let Some(data) = line.strip_prefix("data: ") {
                if let Ok(event) = serde_json::from_str::<serde_json::Value>(data) {
                    match event.get("type").and_then(|t| t.as_str()) {
                        Some("message_start") => {
                            if let Some(msg) = event.get("message") {
                                if let Some(model) = msg.get("model") {
                                    metadata["model"] = model.clone();
                                }
                                if let Some(id) = msg.get("id") {
                                    metadata["message_id"] = id.clone();
                                }
                            }
                        }
                        Some("content_block_start") => {
                            if let Some(block) = event.get("content_block") {
                                if block.get("type").and_then(|t| t.as_str()) == Some("tool_use") {
                                    current_tool_id = block.get("id").and_then(|v| v.as_str()).map(String::from);
                                    current_tool_name = block.get("name").and_then(|v| v.as_str()).map(String::from);
                                    current_tool_input.clear();
                                }
                            }
                        }
                        Some("content_block_delta") => {
                            if let Some(delta) = event.get("delta") {
                                match delta.get("type").and_then(|t| t.as_str()) {
                                    Some("thinking_delta") => {
                                        if let Some(t) = delta.get("thinking").and_then(|v| v.as_str()) {
                                            thinking.push_str(t);
                                        }
                                    }
                                    Some("text_delta") => {
                                        if let Some(t) = delta.get("text").and_then(|v| v.as_str()) {
                                            text.push_str(t);
                                        }
                                    }
                                    Some("input_json_delta") => {
                                        if let Some(json) = delta.get("partial_json").and_then(|v| v.as_str()) {
                                            current_tool_input.push_str(json);
                                        }
                                    }
                                    _ => {}
                                }
                            }
                        }
                        Some("content_block_stop") => {
                            // Finalize tool call if we were building one
                            if let (Some(id), Some(name)) = (current_tool_id.take(), current_tool_name.take()) {
                                let input = serde_json::from_str(&current_tool_input)
                                    .unwrap_or(serde_json::json!({}));
                                tool_calls.push(ToolCall { id, name, input });
                                current_tool_input.clear();
                            }
                        }
                        Some("message_delta") => {
                            if let Some(u) = event.get("usage") {
                                usage = Some(Usage {
                                    input_tokens: u.get("input_tokens").and_then(|v| v.as_i64()),
                                    output_tokens: u.get("output_tokens").and_then(|v| v.as_i64()),
                                    cache_read_tokens: u.get("cache_read_input_tokens").and_then(|v| v.as_i64()),
                                    cache_creation_tokens: u.get("cache_creation_input_tokens").and_then(|v| v.as_i64()),
                                });
                            }
                            if let Some(delta) = event.get("delta") {
                                if let Some(reason) = delta.get("stop_reason") {
                                    metadata["stop_reason"] = reason.clone();
                                }
                            }
                        }
                        _ => {}
                    }
                }
            }
        }

        ParsedResponse {
            thinking: if thinking.is_empty() { None } else { Some(thinking) },
            text: if text.is_empty() { None } else { Some(text) },
            tool_calls,
            usage,
            raw: raw.to_string(),
            streaming: true,
            metadata,
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
        let mut thinking = None;
        let mut text = None;
        let mut tool_calls = Vec::new();

        // Extract content blocks
        if let Some(content) = json.get("content").and_then(|c| c.as_array()) {
            for block in content {
                match block.get("type").and_then(|t| t.as_str()) {
                    Some("thinking") => {
                        thinking = block.get("thinking").and_then(|t| t.as_str()).map(String::from);
                    }
                    Some("text") => {
                        text = block.get("text").and_then(|t| t.as_str()).map(String::from);
                    }
                    Some("tool_use") => {
                        if let (Some(id), Some(name)) = (
                            block.get("id").and_then(|v| v.as_str()),
                            block.get("name").and_then(|v| v.as_str()),
                        ) {
                            tool_calls.push(ToolCall {
                                id: id.to_string(),
                                name: name.to_string(),
                                input: block.get("input").cloned().unwrap_or(serde_json::json!({})),
                            });
                        }
                    }
                    _ => {}
                }
            }
        }

        // Extract usage
        let usage = json.get("usage").map(|u| Usage {
            input_tokens: u.get("input_tokens").and_then(|v| v.as_i64()),
            output_tokens: u.get("output_tokens").and_then(|v| v.as_i64()),
            cache_read_tokens: u.get("cache_read_input_tokens").and_then(|v| v.as_i64()),
            cache_creation_tokens: u.get("cache_creation_input_tokens").and_then(|v| v.as_i64()),
        });

        // Build metadata
        let mut metadata = serde_json::json!({});
        if let Some(model) = json.get("model") {
            metadata["model"] = model.clone();
        }
        if let Some(id) = json.get("id") {
            metadata["message_id"] = id.clone();
        }
        if let Some(reason) = json.get("stop_reason") {
            metadata["stop_reason"] = reason.clone();
        }

        ParsedResponse {
            thinking,
            text,
            tool_calls,
            usage,
            raw: json.to_string(),
            streaming: false,
            metadata,
        }
    }

    fn provider(&self) -> &'static str {
        "anthropic"
    }
}

pub fn extract_user_message_text(request_json: &serde_json::Value) -> Option<String> {
    let messages = request_json.get("messages")?.as_array()?;

    let user_msg = messages
        .iter()
        .rev()
        .find(|m| m.get("role").and_then(|r| r.as_str()) == Some("user"))?;

    extract_content_text(user_msg.get("content")?)
}

pub fn extract_model(request_json: &serde_json::Value) -> Option<String> {
    request_json
        .get("model")
        .and_then(|v| v.as_str())
        .map(String::from)
}

fn extract_content_text(content: &serde_json::Value) -> Option<String> {
    match content {
        serde_json::Value::String(s) => Some(s.clone()),
        serde_json::Value::Array(blocks) => {
            let texts: Vec<&str> = blocks
                .iter()
                .filter_map(|block| {
                    if block.get("type").and_then(|t| t.as_str()) == Some("text") {
                        block.get("text").and_then(|t| t.as_str())
                    } else {
                        None
                    }
                })
                .collect();

            if texts.is_empty() {
                None
            } else {
                Some(texts.join("\n"))
            }
        }
        _ => None,
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
