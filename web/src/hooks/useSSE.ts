import { useEffect, useState, useCallback } from 'react';

export interface ProxyEvent {
  id: string;
  timestamp: string;
  event_type: 'request' | 'response';
  data: Record<string, unknown>;
}

export function useSSE(url: string) {
  const [events, setEvents] = useState<ProxyEvent[]>([]);
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

    // Listen for both event types
    const handleEvent = (e: MessageEvent) => {
      try {
        const event: ProxyEvent = JSON.parse(e.data);
        setEvents((prev) => [...prev, event]);
      } catch (err) {
        console.error('Failed to parse event:', err);
      }
    };

    eventSource.addEventListener('request', handleEvent);
    eventSource.addEventListener('response', handleEvent);

    return () => {
      eventSource.close();
    };
  }, [url]);

  return { events, connected, error, clearEvents };
}
