import { useState, useEffect } from 'react';
import { AgentAvatar } from './AgentAvatar';

interface Agent {
  id: string;
  name: string;
  session_id: string;
  working_directory: string | null;
  created_at: string;
  last_seen_at: string;
  status: 'active' | 'inactive';
  topic: string | null;
}

function timeAgo(dateStr: string): string {
  const seconds = Math.floor((Date.now() - new Date(dateStr).getTime()) / 1000);
  if (seconds < 60) return 'just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

export function AgentList() {
  const [agents, setAgents] = useState<Agent[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/agents')
      .then(r => r.json())
      .then(data => { setAgents(data); setLoading(false); })
      .catch(() => setLoading(false));
  }, []);

  return (
    <div style={{
      backgroundColor: '#1a1a1a',
      color: '#fff',
      minHeight: '100vh',
      padding: '16px',
    }}>
      <h1 style={{ margin: '0 0 16px', fontSize: '20px' }}>Sentinel Agents</h1>

      {loading && (
        <div style={{ color: '#666' }}>Loading agents...</div>
      )}

      {!loading && agents.length === 0 && (
        <div style={{ color: '#666', textAlign: 'center', padding: '48px' }}>
          No agents tracked yet. Start a Claude Code session through the proxy.
        </div>
      )}

      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
        gap: '12px',
      }}>
        {agents.map(agent => (
          <a
            key={agent.id}
            href={`#/agents/${encodeURIComponent(agent.name)}`}
            style={{
              textDecoration: 'none',
              color: 'inherit',
              padding: '16px',
              backgroundColor: '#252525',
              borderRadius: '8px',
              border: '1px solid #333',
              cursor: 'pointer',
              display: 'flex',
              gap: '12px',
              alignItems: 'center',
              transition: 'border-color 0.15s',
            }}
            onMouseEnter={e => (e.currentTarget.style.borderColor = '#555')}
            onMouseLeave={e => (e.currentTarget.style.borderColor = '#333')}
          >
            <AgentAvatar name={agent.name} size={48} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{
                fontFamily: 'monospace',
                fontSize: '15px',
                fontWeight: 'bold',
                marginBottom: '4px',
              }}>
                {agent.name}
              </div>
              <div style={{ fontSize: '12px', color: '#888' }}>
                <span style={{
                  color: agent.status === 'active' ? '#4ade80' : '#666',
                }}>
                  {agent.status === 'active' ? '\u25cf' : '\u25cb'}
                </span>
                {' '}{agent.status}
                {' \u00b7 '}
                {timeAgo(agent.last_seen_at)}
              </div>
              {agent.working_directory && (
                <div style={{
                  fontSize: '11px',
                  color: '#666',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                  marginTop: '2px',
                }}>
                  {agent.working_directory}
                </div>
              )}
            </div>
          </a>
        ))}
      </div>
    </div>
  );
}
