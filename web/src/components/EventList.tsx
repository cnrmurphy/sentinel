import { useState, useEffect } from 'react';
import { useSSE } from '../hooks/useSSE';
import type { ObservabilityEvent } from '../hooks/useSSE';

function truncate(text: string, maxLen: number): string {
  if (text.length <= maxLen) return text;
  return text.slice(0, maxLen) + '...';
}

function EventItem({ event }: { event: ObservabilityEvent }) {
  const [expanded, setExpanded] = useState(false);
  const payload = event.payload;
  const isUserMessage = payload.type === 'user_message';
  const arrow = isUserMessage ? '→' : '←';
  const color = isUserMessage ? '#4ade80' : '#60a5fa';
  const time = new Date(event.timestamp).toLocaleTimeString();

  const agent = event.agent;
  const model = payload.model;
  const usage = payload.type === 'assistant_response' ? payload.usage : null;

  // Build summary
  let summary = '';
  if (payload.type === 'user_message') {
    summary = truncate(payload.text, 80);
  } else if (payload.text) {
    summary = truncate(payload.text, 80);
  }

  return (
    <div
      style={{
        borderBottom: '1px solid #333',
        fontFamily: 'monospace',
        fontSize: '13px',
      }}
    >
      <div
        onClick={() => setExpanded(!expanded)}
        style={{
          padding: '8px 12px',
          cursor: 'pointer',
          display: 'flex',
          flexDirection: 'column',
          gap: '4px',
        }}
      >
        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
          <span style={{ color: '#888' }}>{time}</span>
          <span style={{ color, fontWeight: 'bold' }}>{arrow}</span>
          <span style={{ color }}>
            {isUserMessage ? 'request' : 'response'}
          </span>
          {agent && <span style={{ color: '#f59e0b' }}>[{agent}]</span>}
          {model && <span style={{ color: '#a78bfa' }}>{model}</span>}
          {usage && (
            <span style={{ color: '#888' }}>
              {usage.input_tokens ?? 0}→{usage.output_tokens ?? 0} tokens
            </span>
          )}
          <span style={{ marginLeft: 'auto', color: '#555' }}>
            {expanded ? '▼' : '▶'}
          </span>
        </div>
        {summary && (
          <div style={{ color: '#999', paddingLeft: '24px' }}>{summary}</div>
        )}
      </div>

      {expanded && (
        <div
          style={{
            padding: '12px',
            paddingTop: '0',
            display: 'flex',
            flexDirection: 'column',
            gap: '12px',
          }}
        >
          {/* Request: Show user message text */}
          {payload.type === 'user_message' && (
            <div>
              <div style={{ color: '#4ade80', marginBottom: '4px' }}>
                User prompt:
              </div>
              <pre
                style={{
                  margin: 0,
                  padding: '8px',
                  backgroundColor: '#252525',
                  borderRadius: '4px',
                  whiteSpace: 'pre-wrap',
                  wordBreak: 'break-word',
                  maxHeight: '200px',
                  overflow: 'auto',
                }}
              >
                {payload.text}
              </pre>
            </div>
          )}

          {/* Response: Show thinking */}
          {payload.type === 'assistant_response' && payload.thinking && (
            <div>
              <div style={{ color: '#f59e0b', marginBottom: '4px' }}>
                Thinking:
              </div>
              <pre
                style={{
                  margin: 0,
                  padding: '8px',
                  backgroundColor: '#252525',
                  borderRadius: '4px',
                  whiteSpace: 'pre-wrap',
                  wordBreak: 'break-word',
                  maxHeight: '200px',
                  overflow: 'auto',
                  color: '#f59e0b',
                }}
              >
                {payload.thinking}
              </pre>
            </div>
          )}

          {/* Response: Show text */}
          {payload.type === 'assistant_response' && payload.text && (
            <div>
              <div style={{ color: '#60a5fa', marginBottom: '4px' }}>
                Response:
              </div>
              <pre
                style={{
                  margin: 0,
                  padding: '8px',
                  backgroundColor: '#252525',
                  borderRadius: '4px',
                  whiteSpace: 'pre-wrap',
                  wordBreak: 'break-word',
                  maxHeight: '300px',
                  overflow: 'auto',
                }}
              >
                {payload.text}
              </pre>
            </div>
          )}

          {/* Response: Show tool calls */}
          {payload.type === 'assistant_response' &&
            payload.tool_calls.length > 0 && (
              <div>
                <div style={{ color: '#a78bfa', marginBottom: '4px' }}>
                  Tool calls ({payload.tool_calls.length}):
                </div>
                {payload.tool_calls.map((tool, i) => (
                  <div
                    key={tool.id || i}
                    style={{
                      padding: '8px',
                      backgroundColor: '#252525',
                      borderRadius: '4px',
                      marginBottom: '4px',
                    }}
                  >
                    <div style={{ color: '#a78bfa' }}>{tool.name}</div>
                    <pre
                      style={{
                        margin: 0,
                        marginTop: '4px',
                        whiteSpace: 'pre-wrap',
                        wordBreak: 'break-word',
                        fontSize: '11px',
                        color: '#888',
                        maxHeight: '150px',
                        overflow: 'auto',
                      }}
                    >
                      {JSON.stringify(tool.input, null, 2)}
                    </pre>
                  </div>
                ))}
              </div>
            )}
        </div>
      )}
    </div>
  );
}

interface EventListProps {
  agentName?: string;
}

export function EventList({ agentName }: EventListProps) {
  const [initialEvents, setInitialEvents] = useState<
    ObservabilityEvent[] | undefined
  >(undefined);

  // Fetch historical events when viewing an agent's event log
  useEffect(() => {
    if (!agentName) {
      setInitialEvents(undefined);
      return;
    }

    fetch(`/api/agents/${encodeURIComponent(agentName)}/events`)
      .then((res) => res.json())
      .then((data: ObservabilityEvent[]) => {
        setInitialEvents(data);
      })
      .catch((err) => {
        console.error('Failed to fetch historical events:', err);
        setInitialEvents([]);
      });
  }, [agentName]);

  const sseUrl = agentName
    ? `/api/events?agent=${encodeURIComponent(agentName)}`
    : '/api/events';
  const { events, connected, error, clearEvents } = useSSE(sseUrl, initialEvents);

  return (
    <div
      style={{
        backgroundColor: '#1a1a1a',
        color: '#fff',
        minHeight: '100vh',
        padding: '16px',
      }}
    >
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: '16px',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          {agentName && (
            <a href="#/" style={{ color: '#60a5fa', textDecoration: 'none', fontSize: '14px' }}>
              &larr; Agents
            </a>
          )}
          <h1 style={{ margin: 0, fontSize: '20px' }}>
            {agentName ? `${agentName}` : 'Sentinel Events'}
          </h1>
        </div>
        <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
          <span
            style={{
              color: connected ? '#4ade80' : '#ef4444',
              fontSize: '12px',
            }}
          >
            {connected ? '● Connected' : '○ Disconnected'}
          </span>
          <button
            onClick={clearEvents}
            style={{
              padding: '4px 12px',
              backgroundColor: '#333',
              color: '#fff',
              border: 'none',
              borderRadius: '4px',
              cursor: 'pointer',
            }}
          >
            Clear
          </button>
        </div>
      </div>

      {error && (
        <div style={{ color: '#f59e0b', marginBottom: '12px', fontSize: '13px' }}>
          {error}
        </div>
      )}

      <div
        style={{
          border: '1px solid #333',
          borderRadius: '4px',
          overflow: 'hidden',
        }}
      >
        {events.length === 0 ? (
          <div style={{ padding: '24px', textAlign: 'center', color: '#666' }}>
            Waiting for events...
          </div>
        ) : (
          events.map((event) => <EventItem key={event.id} event={event} />)
        )}
      </div>

      <div style={{ marginTop: '12px', color: '#666', fontSize: '12px' }}>
        {events.length} event(s)
      </div>
    </div>
  );
}
