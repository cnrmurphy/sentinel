import { useEffect, useState, useCallback } from 'react';

export interface ToolCall {
  id: string;
  name: string;
  input: Record<string, unknown>;
}

export interface Usage {
  input_tokens: number | null;
  output_tokens: number | null;
  cache_read_tokens: number | null;
  cache_creation_tokens: number | null;
}

export interface UserMessage {
  type: 'user_message';
  model: string | null;
  text: string;
}

export interface AssistantResponse {
  type: 'assistant_response';
  streaming: boolean;
  model: string | null;
  message_id: string | null;
  stop_reason: string | null;
  thinking: string | null;
  text: string | null;
  tool_calls: ToolCall[];
  usage: Usage | null;
}

export type Payload = UserMessage | AssistantResponse;

export interface ObservabilityEvent {
  seq: number | null;
  id: string;
  timestamp: string;
  session_id: string | null;
  agent: string | null;
  payload: Payload;
}

interface SSeMessageEnvelope {
  type: 'observability_event' | 'resync_required';
  payload:
    | { event: ObservabilityEvent }
    | { events_dropped: number; latest_seq: number };
}

export function useSSE(url: string) {
  const [events, setEvents] = useState<ObservabilityEvent[]>([]);
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const clearEvents = useCallback(() => {
    setEvents([]);
  }, []);

  useEffect(() => {
    const eventSource = new EventSource(url);

    eventSource.onopen = () => {
      setConnected(true);
      setError(null);
    };

    eventSource.onerror = () => {
      setConnected(false);
      setError('Connection lost. Retrying...');
    };

    const handleMessage = (e: MessageEvent) => {
      try {
        const envelope: SSeMessageEnvelope = JSON.parse(e.data);

        if (envelope.type === 'observability_event') {
          const { event } = envelope.payload as { event: ObservabilityEvent };
          setEvents((prev) => [...prev, event]);
        } else if (envelope.type === 'resync_required') {
          console.warn('Events dropped, resync required:', envelope.payload);
        }
      } catch (err) {
        console.error('Failed to parse event:', err);
      }
    };

    eventSource.addEventListener('message', handleMessage);

    return () => {
      eventSource.close();
    };
  }, [url]);

  return { events, connected, error, clearEvents };
}
