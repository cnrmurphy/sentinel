use std::{convert::Infallible, sync::Arc, time::Duration};

use axum::{
    extract::State,
    response::sse::{Event, KeepAlive, Sse},
};
use futures_util::Stream;

use crate::proxy::ProxyState;

pub async fn sse_handler(
    State(state): State<Arc<ProxyState>>,
) -> Sse<impl Stream<Item = Result<Event, Infallible>>> {
    let mut rx = state.event_broadcaster.subscribe();

    let stream = async_stream::stream! {
        while let Ok(event) = rx.recv().await {
            let json = serde_json::to_string(&event).unwrap_or_default();
            yield Ok(Event::default()
                .event(&event.event_type)
                .data(json));
        }
    };

    Sse::new(stream).keep_alive(
        KeepAlive::new()
            .interval(Duration::from_secs(15))
            .text("keep-alive"),
    )
}
