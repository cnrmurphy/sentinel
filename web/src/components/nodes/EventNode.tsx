import { memo } from 'react';
import { Handle, Position } from '@xyflow/react';
import type { ObservabilityEvent } from '../../hooks/useSSE';

export interface EventNodeData extends Record<string, unknown> {
  event: ObservabilityEvent;
  isLatest?: boolean;
}

function truncate(text: string, maxLen: number): string {
  if (text.length <= maxLen) return text;
  return text.slice(0, maxLen) + '...';
}

interface EventNodeProps {
  data: EventNodeData;
}

function EventNodeComponent({ data }: EventNodeProps) {
  const { event, isLatest } = data;
  const payload = event.payload;
  const isUserMessage = payload.type === 'user_message';
  const arrow = isUserMessage ? '→' : '←';
  const color = isUserMessage ? '#4ade80' : '#60a5fa';
  const time = new Date(event.timestamp).toLocaleTimeString();

  const agent = event.agent;
  const model = payload.model;
  const usage = payload.type === 'assistant_response' ? payload.usage : null;

  // Detect "awaiting input" state: latest response with pending tool calls
  const isAwaitingInput =
    isLatest &&
    payload.type === 'assistant_response' &&
    payload.tool_calls.length > 0;

  // Debug logging
  if (isLatest && payload.type === 'assistant_response') {
    console.log('Latest response:', {
      isLatest,
      stop_reason: payload.stop_reason,
      tool_calls_count: payload.tool_calls.length,
      tool_calls: payload.tool_calls,
      isAwaitingInput
    });
  }

  let summary = '';
  if (payload.type === 'user_message') {
    summary = truncate(payload.text, 60);
  } else if (payload.text) {
    summary = truncate(payload.text, 60);
  } else if (payload.tool_calls.length > 0) {
    summary = `${payload.tool_calls.length} tool call(s)`;
  }

  return (
    <>
      <Handle type="target" position={Position.Top} style={{ visibility: 'hidden' }} />
      <div
        className="event-node"
        data-type={isUserMessage ? 'request' : 'response'}
        style={{
          padding: '10px 14px',
          backgroundColor: '#1e1e1e',
          border: '2px solid #333',
          borderRadius: '8px',
          fontFamily: 'monospace',
          fontSize: '12px',
          width: '320px',
          cursor: 'pointer',
          transition: 'border-color 0.15s, background-color 0.15s',
        }}
      >
        <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
          <span style={{ color: '#888' }}>{time}</span>
          <span style={{ color, fontWeight: 'bold' }}>{arrow}</span>
          <span style={{ color }}>{isUserMessage ? 'request' : 'response'}</span>
          {isAwaitingInput && (
            <span
              className="awaiting-input-badge"
              style={{
                color: '#fbbf24',
                backgroundColor: 'rgba(251, 191, 36, 0.15)',
                padding: '1px 6px',
                borderRadius: '4px',
                fontSize: '11px',
                fontWeight: 'bold',
              }}
            >
              awaiting input
            </span>
          )}
          {agent && (
            <span
              style={{
                color: '#f59e0b',
                backgroundColor: 'rgba(245, 158, 11, 0.1)',
                padding: '1px 6px',
                borderRadius: '4px',
                fontSize: '11px',
              }}
            >
              {agent}
            </span>
          )}
          {model && (
            <span
              style={{
                color: '#a78bfa',
                backgroundColor: 'rgba(167, 139, 250, 0.1)',
                padding: '1px 6px',
                borderRadius: '4px',
                fontSize: '11px',
              }}
            >
              {model}
            </span>
          )}
        </div>
        {usage && (
          <div style={{ color: '#888', fontSize: '11px', marginTop: '4px' }}>
            {usage.input_tokens ?? 0} → {usage.output_tokens ?? 0} tokens
          </div>
        )}
        {summary && (
          <div
            style={{
              color: '#999',
              marginTop: '6px',
              fontSize: '11px',
              lineHeight: '1.4',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {summary}
          </div>
        )}
      </div>
      <Handle type="source" position={Position.Bottom} style={{ visibility: 'hidden' }} />
    </>
  );
}

export const EventNode = memo(EventNodeComponent);
