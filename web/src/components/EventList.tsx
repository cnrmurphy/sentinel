import { useState } from 'react';
import { useSSE } from '../hooks/useSSE';
import type { ObservabilityEvent } from '../hooks/useSSE';

interface Message {
  role: string;
  content: string | Array<{ type: string; text?: string }>;
}

interface ParsedResponse {
  text?: string;
  thinking?: string;
  tool_calls?: Array<{ name: string; input: Record<string, unknown> }>;
  usage?: { input_tokens: number; output_tokens: number };
}

function getLastUserMessage(messages: Message[]): string | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === 'user') {
      const content = messages[i].content;
      if (typeof content === 'string') {
        return content;
      }
      if (Array.isArray(content)) {
        const textBlock = content.find((b) => b.type === 'text');
        return textBlock?.text ?? null;
      }
    }
  }
  return null;
}

function truncate(text: string, maxLen: number): string {
  if (text.length <= maxLen) return text;
  return text.slice(0, maxLen) + '...';
}

function EventItem({ event }: { event: ObservabilityEvent }) {
  const [expanded, setExpanded] = useState(false);
  const isRequest = event.event_type === 'request';
  const arrow = isRequest ? '→' : '←';
  const color = isRequest ? '#4ade80' : '#60a5fa';
  const time = new Date(event.timestamp).toLocaleTimeString();

  // Extract summary info
  const agent = event.data.agent as string | undefined;
  const method = event.data.method as string | undefined;
  const path = event.data.path as string | undefined;
  const status = event.data.status as number | undefined;
  const body = event.data.body as Record<string, unknown> | undefined;
  const parsed = event.data.parsed as ParsedResponse | undefined;

  // Request-specific
  const messages = body?.messages as Message[] | undefined;
  const model = body?.model as string | undefined;
  const lastUserMessage = messages ? getLastUserMessage(messages) : null;

  // Response-specific
  const responseText = parsed?.text;
  const thinking = parsed?.thinking;
  const toolCalls = parsed?.tool_calls;
  const usage = parsed?.usage;

  // Build summary
  let summary = '';
  if (isRequest && lastUserMessage) {
    summary = truncate(lastUserMessage, 80);
  } else if (!isRequest && responseText) {
    summary = truncate(responseText, 80);
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
          <span style={{ color }}>{event.event_type}</span>
          {agent && <span style={{ color: '#f59e0b' }}>[{agent}]</span>}
          {method && <span>{method}</span>}
          {path && <span style={{ color: '#888' }}>{path}</span>}
          {status && (
            <span style={{ color: status < 400 ? '#4ade80' : '#ef4444' }}>
              {status}
            </span>
          )}
          {model && <span style={{ color: '#a78bfa' }}>{model}</span>}
          {usage && (
            <span style={{ color: '#888' }}>
              {usage.input_tokens}→{usage.output_tokens} tokens
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
          {/* Request: Show last user message */}
          {isRequest && lastUserMessage && (
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
                {lastUserMessage}
              </pre>
            </div>
          )}

          {/* Response: Show thinking */}
          {!isRequest && thinking && (
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
                {thinking}
              </pre>
            </div>
          )}

          {/* Response: Show text */}
          {!isRequest && responseText && (
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
                {responseText}
              </pre>
            </div>
          )}

          {/* Response: Show tool calls */}
          {!isRequest && toolCalls && toolCalls.length > 0 && (
            <div>
              <div style={{ color: '#a78bfa', marginBottom: '4px' }}>
                Tool calls ({toolCalls.length}):
              </div>
              {toolCalls.map((tool, i) => (
                <div
                  key={i}
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

          {/* Messages count for requests */}
          {isRequest && messages && (
            <div style={{ color: '#666', fontSize: '11px' }}>
              {messages.length} message(s) in conversation
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export function EventList() {
  const { events, connected, error, clearEvents } = useSSE('/api/events');

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
        <h1 style={{ margin: 0, fontSize: '20px' }}>Sentinel Events</h1>
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
