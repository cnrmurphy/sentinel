import { useState, useEffect } from 'react';
import { useSSE } from '../hooks/useSSE';
import { EventFlow } from './EventFlow';
import type { ObservabilityEvent } from '../hooks/useSSE';

interface EventListProps {
  agentName?: string;
}

export function EventList({ agentName }: EventListProps) {
  const [initialEvents, setInitialEvents] = useState<
    ObservabilityEvent[] | undefined
  >(undefined);
  const [followLatest, setFollowLatest] = useState(true);

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
  const { events, connected, error, clearEvents, agentPhases } = useSSE(sseUrl, initialEvents);

  return (
    <div
      style={{
        backgroundColor: '#1a1a1a',
        color: '#fff',
        height: '100vh',
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          padding: '12px 16px',
          borderBottom: '1px solid #333',
          flexShrink: 0,
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
          <span style={{ color: '#666', fontSize: '12px' }}>
            {events.length} event(s)
          </span>
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
            onClick={() => setFollowLatest(!followLatest)}
            style={{
              padding: '4px 12px',
              backgroundColor: followLatest ? '#4ade80' : '#333',
              color: followLatest ? '#000' : '#fff',
              border: 'none',
              borderRadius: '4px',
              cursor: 'pointer',
              fontSize: '12px',
            }}
          >
            {followLatest ? 'Following' : 'Follow'}
          </button>
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
        <div style={{ color: '#f59e0b', padding: '8px 16px', fontSize: '13px', flexShrink: 0 }}>
          {error}
        </div>
      )}

      <div style={{ flex: 1, position: 'relative' }}>
        {events.length === 0 ? (
          <div style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            height: '100%',
            color: '#666'
          }}>
            Waiting for events...
          </div>
        ) : (
          <EventFlow events={events} followLatest={followLatest} agentPhases={agentPhases} />
        )}
      </div>
    </div>
  );
}
