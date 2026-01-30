import type { ObservabilityEvent } from '../hooks/useSSE';

interface EventDetailPanelProps {
  event: ObservabilityEvent;
  position: { x: number; y: number };
  onClose: () => void;
}

export function EventDetailPanel({ event, position, onClose }: EventDetailPanelProps) {
  const payload = event.payload;
  const isUserMessage = payload.type === 'user_message';

  return (
    <div
      style={{
        position: 'absolute',
        left: position.x,
        top: position.y,
        width: '400px',
        maxHeight: '500px',
        backgroundColor: '#1e1e1e',
        border: '1px solid #444',
        borderRadius: '8px',
        boxShadow: '0 8px 32px rgba(0, 0, 0, 0.5)',
        zIndex: 1000,
        overflow: 'hidden',
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      <div
        style={{
          padding: '12px 16px',
          borderBottom: '1px solid #333',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          backgroundColor: '#252525',
        }}
      >
        <div style={{ fontFamily: 'monospace', fontSize: '13px' }}>
          <span style={{ color: isUserMessage ? '#4ade80' : '#60a5fa', fontWeight: 'bold' }}>
            {isUserMessage ? 'Request' : 'Response'}
          </span>
          <span style={{ color: '#888', marginLeft: '12px' }}>
            {new Date(event.timestamp).toLocaleString()}
          </span>
        </div>
        <button
          onClick={onClose}
          style={{
            background: 'none',
            border: 'none',
            color: '#888',
            cursor: 'pointer',
            fontSize: '18px',
            padding: '0 4px',
            lineHeight: 1,
          }}
        >
          ×
        </button>
      </div>

      <div
        style={{
          padding: '16px',
          overflow: 'auto',
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
          gap: '16px',
          fontFamily: 'monospace',
          fontSize: '12px',
        }}
      >
        {payload.type === 'user_message' && (
          <div>
            <div style={{ color: '#4ade80', marginBottom: '8px', fontWeight: 'bold' }}>
              User prompt
            </div>
            <pre
              style={{
                margin: 0,
                padding: '12px',
                backgroundColor: '#252525',
                borderRadius: '6px',
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-word',
                maxHeight: '300px',
                overflow: 'auto',
                lineHeight: '1.5',
              }}
            >
              {payload.text}
            </pre>
          </div>
        )}

        {payload.type === 'assistant_response' && payload.thinking && (
          <div>
            <div style={{ color: '#f59e0b', marginBottom: '8px', fontWeight: 'bold' }}>
              Thinking
            </div>
            <pre
              style={{
                margin: 0,
                padding: '12px',
                backgroundColor: '#252525',
                borderRadius: '6px',
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-word',
                maxHeight: '200px',
                overflow: 'auto',
                color: '#f59e0b',
                lineHeight: '1.5',
              }}
            >
              {payload.thinking}
            </pre>
          </div>
        )}

        {payload.type === 'assistant_response' && payload.text && (
          <div>
            <div style={{ color: '#60a5fa', marginBottom: '8px', fontWeight: 'bold' }}>
              Response
            </div>
            <pre
              style={{
                margin: 0,
                padding: '12px',
                backgroundColor: '#252525',
                borderRadius: '6px',
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-word',
                maxHeight: '300px',
                overflow: 'auto',
                lineHeight: '1.5',
              }}
            >
              {payload.text}
            </pre>
          </div>
        )}

        {payload.type === 'assistant_response' && payload.tool_calls.length > 0 && (
          <div>
            <div style={{ color: '#a78bfa', marginBottom: '8px', fontWeight: 'bold' }}>
              Tool calls ({payload.tool_calls.length})
            </div>
            {payload.tool_calls.map((tool, i) => (
              <div
                key={tool.id || i}
                style={{
                  padding: '12px',
                  backgroundColor: '#252525',
                  borderRadius: '6px',
                  marginBottom: '8px',
                }}
              >
                <div style={{ color: '#a78bfa', marginBottom: '8px' }}>{tool.name}</div>
                <pre
                  style={{
                    margin: 0,
                    whiteSpace: 'pre-wrap',
                    wordBreak: 'break-word',
                    fontSize: '11px',
                    color: '#888',
                    maxHeight: '150px',
                    overflow: 'auto',
                    lineHeight: '1.4',
                  }}
                >
                  {JSON.stringify(tool.input, null, 2)}
                </pre>
              </div>
            ))}
          </div>
        )}

        {payload.type === 'assistant_response' && payload.usage && (
          <div
            style={{
              padding: '12px',
              backgroundColor: '#252525',
              borderRadius: '6px',
              color: '#888',
              fontSize: '11px',
            }}
          >
            <div style={{ marginBottom: '4px' }}>
              Input tokens: {payload.usage.input_tokens ?? 0}
            </div>
            <div style={{ marginBottom: '4px' }}>
              Output tokens: {payload.usage.output_tokens ?? 0}
            </div>
            {payload.usage.cache_read_tokens != null && (
              <div style={{ marginBottom: '4px' }}>
                Cache read: {payload.usage.cache_read_tokens}
              </div>
            )}
            {payload.usage.cache_creation_tokens != null && (
              <div>Cache creation: {payload.usage.cache_creation_tokens}</div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
