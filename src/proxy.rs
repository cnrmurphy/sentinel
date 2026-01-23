use axum::{
    body::Body,
    extract::State,
    http::{Request, StatusCode},
    response::Response,
};
use bytes::Bytes;
use futures::StreamExt;
use reqwest::Client;
use std::sync::Arc;
use tracing::{info, warn};
use uuid::Uuid;

use crate::agent::AgentStore;
use crate::event::{ObservabilityEvent, Payload, UserMessage};
use crate::parsers::{AnthropicRequest, ResponseParser};
use crate::storage::{Event, Storage};

const ANTHROPIC_API_URL: &str = "https://api.anthropic.com";

#[derive(Clone)]
pub struct ProxyState {
    pub storage: Storage,
    pub agent_store: AgentStore,
    pub http_client: Client,
    pub session_id: Uuid,
    pub parser: Arc<dyn ResponseParser>,
    pub event_broadcaster: tokio::sync::broadcast::Sender<ObservabilityEvent>,
}

pub async fn proxy_handler(
    State(state): State<Arc<ProxyState>>,
    req: Request<Body>,
) -> Result<Response<Body>, StatusCode> {
    let method = req.method().clone();
    let uri = req.uri().clone();
    let headers = req.headers().clone();

    // Read request body
    let body_bytes = match axum::body::to_bytes(req.into_body(), usize::MAX).await {
        Ok(bytes) => bytes,
        Err(e) => {
            warn!("Failed to read request body: {}", e);
            return Err(StatusCode::BAD_REQUEST);
        }
    };

    // Parse request body as JSON for storage and typed access
    let request_json: serde_json::Value = serde_json::from_slice(&body_bytes).unwrap_or_default();
    let request: Option<AnthropicRequest> = serde_json::from_slice(&body_bytes).ok();

    let claude_session_id = extract_claude_session_id(&request);
    let working_dir = extract_working_directory(&request);

    // Track agent if we have a Claude session_id
    let agent_name = if let Some(ref session_id) = claude_session_id {
        match state
            .agent_store
            .get_or_create_agent(session_id, working_dir.as_deref())
            .await
        {
            Ok(agent) => Some(agent.name),
            Err(e) => {
                warn!("Failed to track agent: {}", e);
                None
            }
        }
    } else {
        None
    };

    // Skip telemetry events - they're just metadata noise
    let is_telemetry = uri.path().contains("event_logging");

    // Log the request (non-blocking, errors logged internally)
    let request_event = Event::request(
        state.session_id,
        serde_json::json!({
            "method": method.to_string(),
            "path": uri.path(),
            "body": request_json,
            "agent": agent_name,
            "claude_session_id": claude_session_id,
        }),
    );

    if !is_telemetry {
        if let Err(e) = state.storage.insert_event(&request_event).await {
            tracing::error!("Failed to store request event: {}", e);
        }

        if let Some(ref req) = request {
            if let Some(text) = req.last_user_message_text() {
                let _ = state.event_broadcaster.send(ObservabilityEvent {
                    seq: None,
                    id: request_event.id,
                    timestamp: request_event.timestamp,
                    session_id: claude_session_id.clone(),
                    agent: agent_name.clone(),
                    payload: Payload::UserMessage(UserMessage {
                        model: Some(req.model.clone()),
                        text,
                    }),
                });
            }
        }
    }

    let agent_info = agent_name.as_ref().map(|n| format!(" [{}]", n)).unwrap_or_default();
    if !is_telemetry {
        info!(
            "→ {} {}{} ({} bytes)",
            method,
            uri.path(),
            agent_info,
            body_bytes.len()
        );
    }

    // Build the forwarding URL
    let forward_url = format!(
        "{}{}",
        ANTHROPIC_API_URL,
        uri.path_and_query().map(|pq| pq.as_str()).unwrap_or("")
    );

    // Build forwarding request
    let mut forward_req = state.http_client.request(method, &forward_url);

    // Copy headers (except host)
    for (name, value) in headers.iter() {
        if name != "host" {
            forward_req = forward_req.header(name, value);
        }
    }

    // Send request
    let response = match forward_req.body(body_bytes.to_vec()).send().await {
        Ok(resp) => resp,
        Err(e) => {
            warn!("Failed to forward request: {}", e);
            return Err(StatusCode::BAD_GATEWAY);
        }
    };

    let status = response.status();
    let response_headers = response.headers().clone();

    // Check if this is a streaming response
    let content_type = response_headers
        .get("content-type")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("");

    let is_streaming = content_type.contains("text/event-stream");

    if is_streaming {
        handle_streaming_response(state, response, status, response_headers, is_telemetry, claude_session_id, agent_name).await
    } else {
        handle_regular_response(state, response, status, response_headers, is_telemetry, claude_session_id, agent_name).await
    }
}

async fn handle_streaming_response(
    state: Arc<ProxyState>,
    response: reqwest::Response,
    status: reqwest::StatusCode,
    response_headers: reqwest::header::HeaderMap,
    is_telemetry: bool,
    claude_session_id: Option<String>,
    agent_name: Option<String>,
) -> Result<Response<Body>, StatusCode> {
    let mut stream = response.bytes_stream();
    let (tx, rx) = tokio::sync::mpsc::channel::<Result<Bytes, std::io::Error>>(32);

    let storage = state.storage.clone();
    let session_id = state.session_id;
    let parser = state.parser.clone();
    let event_broadcaster = state.event_broadcaster.clone();

    // Spawn task to collect and forward chunks
    tokio::spawn(async move {
        let mut response_chunks: Vec<Bytes> = Vec::new();

        while let Some(chunk_result) = stream.next().await {
            match chunk_result {
                Ok(chunk) => {
                    response_chunks.push(chunk.clone());
                    if tx.send(Ok(chunk)).await.is_err() {
                        break;
                    }
                }
                Err(e) => {
                    warn!("Error reading stream chunk: {}", e);
                    break;
                }
            }
        }

        // Skip logging for telemetry responses
        if is_telemetry {
            return;
        }

        // Log complete response after stream ends
        let full_response: Vec<u8> = response_chunks
            .iter()
            .flat_map(|c| c.iter().copied())
            .collect();
        let response_text = String::from_utf8_lossy(&full_response);

        // Parse the streaming response into structured data
        let parsed = parser.parse_streaming(&response_text);

        // Log a summary before consuming parsed
        let text_preview = parsed.text.as_ref().map(|t| {
            let preview: String = t.chars().take(50).collect();
            if t.len() > 50 {
                format!("{}...", preview)
            } else {
                preview
            }
        });

        let response_event = Event::response(
            session_id,
            serde_json::json!({
                "streaming": true,
                "parsed": &parsed,
            }),
        );
        if let Err(e) = storage.insert_event(&response_event).await {
            tracing::error!("Failed to store response event: {}", e);
        }

        let _ = event_broadcaster.send(ObservabilityEvent {
            seq: None,
            id: response_event.id,
            timestamp: response_event.timestamp,
            session_id: claude_session_id,
            agent: agent_name,
            payload: Payload::AssistantResponse(parsed.into()),
        });

        info!(
            "← Streaming response complete ({} bytes) text={:?}",
            full_response.len(),
            text_preview
        );
    });

    // Build streaming response
    let stream = tokio_stream::wrappers::ReceiverStream::new(rx);
    let body = Body::from_stream(stream);

    let mut builder = Response::builder().status(status.as_u16());
    for (name, value) in response_headers.iter() {
        builder = builder.header(name, value);
    }

    builder.body(body).map_err(|e| {
        warn!("Failed to build response: {}", e);
        StatusCode::INTERNAL_SERVER_ERROR
    })
}

async fn handle_regular_response(
    state: Arc<ProxyState>,
    response: reqwest::Response,
    status: reqwest::StatusCode,
    response_headers: reqwest::header::HeaderMap,
    is_telemetry: bool,
    claude_session_id: Option<String>,
    agent_name: Option<String>,
) -> Result<Response<Body>, StatusCode> {
    let response_bytes = match response.bytes().await {
        Ok(bytes) => bytes,
        Err(e) => {
            warn!("Failed to read response: {}", e);
            return Err(StatusCode::BAD_GATEWAY);
        }
    };

    let response_json: serde_json::Value =
        serde_json::from_slice(&response_bytes).unwrap_or_default();

    if !is_telemetry {
        // Parse the response if it looks like an LLM response
        let parsed =
            if response_json.get("content").is_some() || response_json.get("type").is_some() {
                Some(state.parser.parse_json(&response_json))
            } else {
                None
            };

        // Log the response
        let response_event = Event::response(
            state.session_id,
            serde_json::json!({
                "status": status.as_u16(),
                "body": response_json,
                "parsed": &parsed,
            }),
        );
        if let Err(e) = state.storage.insert_event(&response_event).await {
            tracing::error!("Failed to store response event: {}", e);
        }

        if let Some(parsed) = parsed {
            let _ = state.event_broadcaster.send(ObservabilityEvent {
                seq: None,
                id: response_event.id,
                timestamp: response_event.timestamp,
                session_id: claude_session_id,
                agent: agent_name,
                payload: Payload::AssistantResponse(parsed.into()),
            });
        }

        info!("← {} ({} bytes)", status, response_bytes.len());
    }

    // Build response
    let mut builder = Response::builder().status(status.as_u16());
    for (name, value) in response_headers.iter() {
        builder = builder.header(name, value);
    }

    builder.body(Body::from(response_bytes)).map_err(|e| {
        warn!("Failed to build response: {}", e);
        StatusCode::INTERNAL_SERVER_ERROR
    })
}

fn extract_working_directory(request: &Option<AnthropicRequest>) -> Option<String> {
    use crate::parsers::{ContentBlock, MessageContent, SystemContent};

    let request = request.as_ref()?;

    let search_text = |text: &str| -> Option<String> {
        let start = text.find("Working directory:")?;
        let rest = &text[start + 18..];
        let end = rest.find('\n').unwrap_or(rest.len());
        let dir = rest[..end].trim();
        if dir.is_empty() { None } else { Some(dir.to_string()) }
    };

    if let Some(ref system) = request.system {
        match system {
            SystemContent::Text(t) => {
                if let Some(dir) = search_text(t) {
                    return Some(dir);
                }
            }
            SystemContent::Blocks(blocks) => {
                for block in blocks {
                    if let ContentBlock::Text { text } = block {
                        if let Some(dir) = search_text(text) {
                            return Some(dir);
                        }
                    }
                }
            }
        }
    }

    for msg in &request.messages {
        match &msg.content {
            MessageContent::Text(t) => {
                if let Some(dir) = search_text(t) {
                    return Some(dir);
                }
            }
            MessageContent::Blocks(blocks) => {
                for block in blocks {
                    if let ContentBlock::Text { text } = block {
                        if let Some(dir) = search_text(text) {
                            return Some(dir);
                        }
                    }
                }
            }
        }
    }

    None
}

fn extract_claude_session_id(request: &Option<AnthropicRequest>) -> Option<String> {
    let user_id = request.as_ref()?.metadata.as_ref()?.user_id.as_ref()?;
    let (_, session) = user_id.rsplit_once("_session_")?;
    if session.is_empty() { None } else { Some(session.to_string()) }
}
