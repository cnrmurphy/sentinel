import { useMemo, useState, useCallback, useEffect, useRef } from 'react';
import {
  ReactFlow,
  Background,
  useReactFlow,
  ReactFlowProvider,
  type Node,
  type Edge,
  type NodeMouseHandler,
  type NodeTypes,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';

import { EventNode, type EventNodeData } from './nodes/EventNode';
import { EventDetailPanel } from './EventDetailPanel';
import type { ObservabilityEvent } from '../hooks/useSSE';

const nodeTypes: NodeTypes = {
  event: EventNode,
};

const NODE_WIDTH = 320;
const NODE_HEIGHT = 80;
const NODE_GAP = 20;
const SESSION_GAP = 60;

interface EventFlowInnerProps {
  events: ObservabilityEvent[];
  followLatest: boolean;
}

function EventFlowInner({ events, followLatest }: EventFlowInnerProps) {
  const [selectedEventId, setSelectedEventId] = useState<string | null>(null);
  const { flowToScreenPosition, setCenter } = useReactFlow();
  const prevEventCountRef = useRef(events.length);

  // Group events by session_id
  const groupedEvents = useMemo(() => {
    const groups: Map<string, ObservabilityEvent[]> = new Map();

    for (const event of events) {
      const sessionId = event.session_id ?? 'no-session';
      const group = groups.get(sessionId);
      if (group) {
        group.push(event);
      } else {
        groups.set(sessionId, [event]);
      }
    }

    return groups;
  }, [events]);

  // Build nodes and edges
  const { nodes, edges } = useMemo(() => {
    const nodes: Node[] = [];
    const edges: Edge[] = [];

    let yOffset = 0;
    let prevNodeId: string | null = null;
    let sessionIndex = 0;

    for (const [sessionId, sessionEvents] of groupedEvents) {
      // Add session gap (except for first session)
      if (sessionIndex > 0) {
        yOffset += SESSION_GAP;
      }

      // Add session header node
      const sessionHeaderId = `session-header-${sessionId}`;
      nodes.push({
        id: sessionHeaderId,
        type: 'default',
        position: { x: -NODE_WIDTH / 2, y: yOffset },
        data: { label: sessionId === 'no-session' ? 'No Session' : `Session: ${sessionId.slice(0, 8)}...` },
        style: {
          background: 'transparent',
          border: 'none',
          color: '#666',
          fontSize: '11px',
          fontFamily: 'monospace',
          width: NODE_WIDTH,
          textAlign: 'center' as const,
        },
        selectable: false,
        draggable: false,
      });
      yOffset += 30;

      for (const event of sessionEvents) {
        const nodeId = event.id;

        nodes.push({
          id: nodeId,
          type: 'event',
          position: { x: -NODE_WIDTH / 2, y: yOffset },
          data: {
            event,
            selected: selectedEventId === event.id,
          } as EventNodeData,
          draggable: false,
        });

        // Connect to previous node in same session
        if (prevNodeId && prevNodeId !== sessionHeaderId) {
          edges.push({
            id: `edge-${prevNodeId}-${nodeId}`,
            source: prevNodeId,
            target: nodeId,
            type: 'smoothstep',
            style: { stroke: '#444', strokeWidth: 2 },
            animated: false,
          });
        }

        prevNodeId = nodeId;
        yOffset += NODE_HEIGHT + NODE_GAP;
      }

      sessionIndex++;
      // Reset prevNodeId between sessions
      prevNodeId = null;
    }

    return { nodes, edges };
  }, [groupedEvents, selectedEventId]);

  // Auto-pan to latest event when followLatest is enabled
  useEffect(() => {
    if (!followLatest || events.length === 0) return;

    // Only pan when new events are added
    if (events.length <= prevEventCountRef.current) {
      prevEventCountRef.current = events.length;
      return;
    }
    prevEventCountRef.current = events.length;

    const lastEvent = events[events.length - 1];
    const lastNode = nodes.find((n) => n.id === lastEvent.id);
    if (lastNode) {
      setCenter(
        lastNode.position.x + NODE_WIDTH / 2,
        lastNode.position.y + NODE_HEIGHT / 2,
        { duration: 300, zoom: 1 }
      );
    }
  }, [events, nodes, followLatest, setCenter]);

  const selectedEvent = useMemo(() => {
    if (!selectedEventId) return null;
    return events.find((e) => e.id === selectedEventId) ?? null;
  }, [events, selectedEventId]);

  const selectedNodePosition = useMemo(() => {
    if (!selectedEventId) return null;
    const node = nodes.find((n) => n.id === selectedEventId);
    if (!node) return null;

    // Convert flow position to screen position
    const screenPos = flowToScreenPosition({
      x: node.position.x + NODE_WIDTH + 20,
      y: node.position.y,
    });

    return screenPos;
  }, [selectedEventId, nodes, flowToScreenPosition]);

  const handleNodeClick: NodeMouseHandler = useCallback((_event, node) => {
    if (node.type === 'event') {
      setSelectedEventId((prev) => (prev === node.id ? null : node.id));
    }
  }, []);

  const handlePaneClick = useCallback(() => {
    setSelectedEventId(null);
  }, []);

  return (
    <div style={{ width: '100%', height: '100%', position: 'relative' }}>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        onNodeClick={handleNodeClick}
        onPaneClick={handlePaneClick}
        fitView
        fitViewOptions={{ padding: 0.1, minZoom: 1, maxZoom: 1 }}
        minZoom={0.5}
        maxZoom={2}
        defaultViewport={{ x: 0, y: 0, zoom: 1 }}
        proOptions={{ hideAttribution: true }}
        nodesDraggable={false}
        nodesConnectable={false}
        elementsSelectable={false}
        panOnScroll
        zoomOnScroll
      >
        <Background color="#333" gap={20} />
      </ReactFlow>

      {selectedEvent && selectedNodePosition && (
        <EventDetailPanel
          event={selectedEvent}
          position={selectedNodePosition}
          onClose={() => setSelectedEventId(null)}
        />
      )}
    </div>
  );
}

interface EventFlowProps {
  events: ObservabilityEvent[];
  followLatest: boolean;
}

export function EventFlow({ events, followLatest }: EventFlowProps) {
  return (
    <ReactFlowProvider>
      <EventFlowInner events={events} followLatest={followLatest} />
    </ReactFlowProvider>
  );
}
