use std::{convert::Infallible, sync::Arc, time::Duration};

use axum::{
    extract::State,
    response::sse::{Event, KeepAlive, Sse},
};
use futures_util::Stream;
use tokio::sync::broadcast::error::RecvError;

use crate::proxy::{ObservabilityEvent, ProxyState};

#[derive(Debug, Clone, serde::Serialize)]
#[serde(tag = "type", content = "payload", rename_all = "snake_case")]
pub enum SSeMessageEnvelope {
    ObservabilityEvent {
        event: ObservabilityEvent,
    },

    ResyncRequired {
        events_dropped: u64,
        latest_seq: u64,
    },
}

impl From<ObservabilityEvent> for SSeMessageEnvelope {
    fn from(event: ObservabilityEvent) -> Self {
        SSeMessageEnvelope::ObservabilityEvent { event }
    }
}

pub async fn sse_handler(
    State(state): State<Arc<ProxyState>>,
) -> Sse<impl Stream<Item = Result<Event, Infallible>>> {
    let mut event_receiver = state.event_broadcaster.subscribe();

    let stream = async_stream::stream! {
        loop {
            match event_receiver.recv().await {
                Ok(event) => {
                    let msg = SSeMessageEnvelope::from(event);
                    let json = serde_json::to_string(&msg).unwrap_or_default();
                    yield Ok(Event::default()
                        .event("message")
                        .data(json));
                },
                Err(RecvError::Lagged(n)) => {
                    let msg = SSeMessageEnvelope::ResyncRequired{ events_dropped: n, latest_seq: 0 };
                    let json = serde_json::to_string(&msg).unwrap_or_default();
                    yield Ok(Event::default()
                        .event("message")
                        .data(json));
                },
                Err(RecvError::Closed) => {continue},
            }
        }
    };

    Sse::new(stream).keep_alive(
        KeepAlive::new()
            .interval(Duration::from_secs(15))
            .text("keep-alive"),
    )
}
