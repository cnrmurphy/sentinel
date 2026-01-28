import { useHashRoute } from './hooks/useHashRoute';
import { AgentList } from './components/AgentList';
import { EventList } from './components/EventList';

function App() {
  const route = useHashRoute();

  if (route.page === 'agent-detail' && route.agentName) {
    return <EventList agentName={route.agentName} />;
  }

  return <AgentList />;
}

export default App;
