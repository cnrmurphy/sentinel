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

export interface AgentActivity {
  type: 'agent_activity';
  phase: 'thinking' | 'writing' | 'tool_use';
}

export type Payload = UserMessage | AssistantResponse | AgentActivity;

export interface ObservabilityEvent {
  seq: number | null;
  id: string;
  timestamp: string;
  session_id: string | null;
  agent: string | null;
  topic: string | null;
  payload: Payload;
}

interface SSeMessageEnvelope {
  type: 'observability_event' | 'resync_required';
  payload:
    | { event: ObservabilityEvent }
    | { events_dropped: number; latest_seq: number };
}

export function useSSE(url: string, initialEvents?: ObservabilityEvent[]) {
  const [events, setEvents] = useState<ObservabilityEvent[]>(
    initialEvents ?? []
  );
  const [seenIds] = useState<Set<string>>(() => {
    const ids = new Set<string>();
    if (initialEvents) {
      for (const event of initialEvents) {
        ids.add(event.id);
      }
    }
    return ids;
  });
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [agentPhases, setAgentPhases] = useState<Record<string, string>>({});

  const clearEvents = useCallback(() => {
    setEvents([]);
    seenIds.clear();
  }, [seenIds]);

  // Seed with initial events when they change
  useEffect(() => {
    if (initialEvents && initialEvents.length > 0) {
      setEvents(initialEvents);
      seenIds.clear();
      for (const event of initialEvents) {
        seenIds.add(event.id);
      }
    }
  }, [initialEvents, seenIds]);

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

          if (event.payload.type === 'agent_activity' && event.agent) {
            const phase = (event.payload as AgentActivity).phase;
            setAgentPhases((prev) => ({ ...prev, [event.agent!]: phase }));
            return;
          }

          // Clear phase when response arrives
          if (event.payload.type === 'assistant_response' && event.agent) {
            setAgentPhases((prev) => {
              const next = { ...prev };
              delete next[event.agent!];
              return next;
            });
          }

          // Deduplicate: skip if we've already seen this event
          if (seenIds.has(event.id)) {
            return;
          }
          seenIds.add(event.id);
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
  }, [url, seenIds]);

  return { events, connected, error, clearEvents, agentPhases };
}
