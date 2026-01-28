import { useState, useEffect } from 'react';

export interface Route {
  page: 'agents' | 'agent-detail';
  agentName?: string;
}

export function useHashRoute(): Route {
  const [hash, setHash] = useState(window.location.hash);

  useEffect(() => {
    const onHashChange = () => setHash(window.location.hash);
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, []);

  const match = hash.match(/^#\/agents\/(.+)$/);
  if (match) {
    return { page: 'agent-detail', agentName: decodeURIComponent(match[1]) };
  }

  return { page: 'agents' };
}
