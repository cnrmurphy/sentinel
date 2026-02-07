import { useMemo, useState, useCallback, useEffect, useRef } from 'react';
import {
  ReactFlow,
  Background,
  useReactFlow,
  useOnViewportChange,
  ReactFlowProvider,
  type Node,
  type Edge,
  type NodeMouseHandler,
  type NodeTypes,
  type Viewport,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';

// Virtualization buffer - render nodes this far outside the viewport
const VIRTUALIZATION_BUFFER = 1000;

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
const TOPIC_PADDING = 16;
const TOPIC_HEADER_HEIGHT = 32;

interface TopicInfo {
  isNewTopic: boolean;
  title: string | null;
}

function extractTopicInfo(text: string | null): TopicInfo | null {
  if (!text) return null;

  // Look for JSON pattern in the text
  const match = text.match(/\{"isNewTopic"\s*:\s*(true|false)\s*,\s*"title"\s*:\s*(".*?"|null)\}/);
  if (!match) return null;

  try {
    const parsed = JSON.parse(match[0]);
    return {
      isNewTopic: parsed.isNewTopic === true,
      title: parsed.title,
    };
  } catch {
    return null;
  }
}

interface EventFlowInnerProps {
  events: ObservabilityEvent[];
  followLatest: boolean;
}

function EventFlowInner({ events, followLatest }: EventFlowInnerProps) {
  const [selectedEventId, setSelectedEventId] = useState<string | null>(null);
  const [viewport, setViewport] = useState<Viewport>({ x: 0, y: 0, zoom: 1 });
  const [containerHeight, setContainerHeight] = useState(800);
  const containerRef = useRef<HTMLDivElement>(null);
  const { flowToScreenPosition, setCenter } = useReactFlow();
  const prevEventCountRef = useRef(events.length);

  // Track viewport changes for virtualization
  // Use onEnd to avoid constant updates during scrolling, with onChange throttled as backup
  const lastViewportRef = useRef<Viewport>(viewport);
  const viewportTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useOnViewportChange({
    onChange: useCallback((vp: Viewport) => {
      lastViewportRef.current = vp;
      // Throttled update during scroll for responsiveness
      if (viewportTimeoutRef.current) return;
      viewportTimeoutRef.current = setTimeout(() => {
        setViewport(lastViewportRef.current);
        viewportTimeoutRef.current = null;
      }, 100);
    }, []),
    onEnd: useCallback((vp: Viewport) => {
      // Immediate update when scrolling stops
      if (viewportTimeoutRef.current) {
        clearTimeout(viewportTimeoutRef.current);
        viewportTimeoutRef.current = null;
      }
      setViewport(vp);
    }, []),
  });

  // Track container size
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const resizeObserver = new ResizeObserver((entries) => {
      for (const entry of entries) {
        setContainerHeight(entry.contentRect.height);
      }
    });

    resizeObserver.observe(container);
    setContainerHeight(container.clientHeight);

    return () => resizeObserver.disconnect();
  }, []);

  // Group events by session_id, then by topic within each session
  const groupedEvents = useMemo(() => {
    const sessions: Map<string, ObservabilityEvent[]> = new Map();

    for (const event of events) {
      const sessionId = event.session_id ?? 'no-session';
      const group = sessions.get(sessionId);
      if (group) {
        group.push(event);
      } else {
        sessions.set(sessionId, [event]);
      }
    }

    return sessions;
  }, [events]);

  // Build nodes and edges
  const { nodes, edges, totalHeight } = useMemo(() => {
    const nodes: Node[] = [];
    const edges: Edge[] = [];

    // Find assistant_response with tool_calls that comes after the most recent user_message
    // in the same session (to filter out internal system noise)
    let awaitingInputEventId: string | null = null;

    // First, find the most recent user_message and its session
    let lastUserMessageSession: string | null = null;
    let lastUserMessageIndex = -1;
    for (let i = events.length - 1; i >= 0; i--) {
      if (events[i].payload.type === 'user_message' && events[i].session_id) {
        lastUserMessageSession = events[i].session_id;
        lastUserMessageIndex = i;
        break;
      }
    }

    // Now find tool_calls AFTER that user_message in the same session
    if (lastUserMessageSession && lastUserMessageIndex >= 0) {
      for (let i = events.length - 1; i > lastUserMessageIndex; i--) {
        const event = events[i];
        if (
          event.session_id === lastUserMessageSession &&
          event.payload.type === 'assistant_response' &&
          event.payload.tool_calls.length > 0
        ) {
          awaitingInputEventId = event.id;
          break;
        }
      }
    }

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

      // Group events by topic within the session
      interface TopicGroup {
        id: string;
        title: string;
        events: ObservabilityEvent[];
      }
      const topicGroups: TopicGroup[] = [];
      const ungroupedEvents: ObservabilityEvent[] = [];
      let currentTopic: TopicGroup | null = null;

      for (const event of sessionEvents) {
        // Check if this event starts a new topic
        if (event.payload.type === 'assistant_response') {
          const topicInfo = extractTopicInfo(event.payload.text);
          if (topicInfo?.isNewTopic && topicInfo.title) {
            // Start a new topic group
            currentTopic = {
              id: `topic-${sessionId}-${topicGroups.length}`,
              title: topicInfo.title,
              events: [],
            };
            topicGroups.push(currentTopic);
          }
        }

        if (currentTopic) {
          currentTopic.events.push(event);
        } else {
          ungroupedEvents.push(event);
        }
      }

      // Render ungrouped events first
      for (const event of ungroupedEvents) {
        const nodeId = event.id;

        nodes.push({
          id: nodeId,
          type: 'event',
          position: { x: -NODE_WIDTH / 2, y: yOffset },
          data: { event, isLatest: event.id === awaitingInputEventId } as EventNodeData,
          draggable: false,
        });

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

      // Render topic groups
      for (const topic of topicGroups) {
        const topicEventsHeight =
          topic.events.length * NODE_HEIGHT +
          (topic.events.length - 1) * NODE_GAP +
          TOPIC_PADDING * 2 +
          TOPIC_HEADER_HEIGHT;

        // Create the topic group node
        const topicGroupId = topic.id;
        nodes.push({
          id: topicGroupId,
          type: 'group',
          position: { x: -NODE_WIDTH / 2 - TOPIC_PADDING, y: yOffset },
          data: {},
          style: {
            width: NODE_WIDTH + TOPIC_PADDING * 2,
            height: topicEventsHeight,
            backgroundColor: 'rgba(99, 102, 241, 0.08)',
            border: '1px solid rgba(99, 102, 241, 0.3)',
            borderRadius: '8px',
          },
          selectable: false,
          draggable: false,
        });

        // Add topic title as a label node inside the group
        const topicLabelId = `${topicGroupId}-label`;
        nodes.push({
          id: topicLabelId,
          type: 'default',
          position: { x: TOPIC_PADDING, y: 8 },
          parentId: topicGroupId,
          extent: 'parent',
          data: { label: topic.title },
          style: {
            background: 'transparent',
            border: 'none',
            color: '#818cf8',
            fontSize: '12px',
            fontFamily: 'monospace',
            fontWeight: 'bold',
            width: NODE_WIDTH,
            padding: 0,
          },
          selectable: false,
          draggable: false,
        });

        // Add events inside the topic group
        let topicYOffset = TOPIC_HEADER_HEIGHT + TOPIC_PADDING;

        for (const event of topic.events) {
          const nodeId = event.id;

          nodes.push({
            id: nodeId,
            type: 'event',
            position: { x: TOPIC_PADDING, y: topicYOffset },
            parentId: topicGroupId,
            extent: 'parent',
            data: { event, isLatest: event.id === awaitingInputEventId } as EventNodeData,
            draggable: false,
          });

          if (prevNodeId && !prevNodeId.startsWith('topic-') && !prevNodeId.endsWith('-label')) {
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
          topicYOffset += NODE_HEIGHT + NODE_GAP;
        }

        yOffset += topicEventsHeight + NODE_GAP;
      }

      sessionIndex++;
      prevNodeId = null;
    }

    return { nodes, edges, totalHeight: yOffset };
  }, [groupedEvents, events]);

  // Filter nodes and edges to only visible ones (virtualization)
  const { visibleNodes, visibleEdges } = useMemo(() => {
    const zoom = viewport.zoom || 1;
    // viewport.y is negative when scrolled down
    const visibleTop = -viewport.y / zoom - VIRTUALIZATION_BUFFER;
    const visibleBottom = -viewport.y / zoom + containerHeight / zoom + VIRTUALIZATION_BUFFER;

    // Helper to get node's absolute Y position
    const getNodeY = (node: Node): number => {
      let y = node.position.y;
      if (node.parentId) {
        const parent = nodes.find((n) => n.id === node.parentId);
        if (parent) y += parent.position.y;
      }
      return y;
    };

    // Build set of visible node IDs (including parents of visible nodes)
    const visibleNodeIds = new Set<string>();
    for (const node of nodes) {
      const y = getNodeY(node);
      const nodeHeight = node.type === 'group'
        ? (node.style?.height as number) || NODE_HEIGHT
        : NODE_HEIGHT;

      // Node is visible if any part of it is in the visible range
      const isVisible = y + nodeHeight >= visibleTop && y <= visibleBottom;

      if (isVisible) {
        visibleNodeIds.add(node.id);
        // Also include parent groups if any child is visible
        if (node.parentId) visibleNodeIds.add(node.parentId);
      }
    }

    // Filter to only visible nodes (including parents)
    const visibleNodes = nodes.filter((node) => visibleNodeIds.has(node.id));

    // Filter edges - include if both ends are visible
    const visibleEdges = edges.filter(
      (edge) => visibleNodeIds.has(edge.source) && visibleNodeIds.has(edge.target)
    );

    return { visibleNodes, visibleEdges };
  }, [nodes, edges, viewport, containerHeight]);

  // Helper to get absolute position (accounting for parent nodes)
  const getAbsolutePosition = useCallback((node: Node) => {
    let x = node.position.x;
    let y = node.position.y;

    if (node.parentId) {
      const parent = nodes.find((n) => n.id === node.parentId);
      if (parent) {
        x += parent.position.x;
        y += parent.position.y;
      }
    }

    return { x, y };
  }, [nodes]);

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
      const absPos = getAbsolutePosition(lastNode);
      setCenter(
        absPos.x + NODE_WIDTH / 2,
        absPos.y + NODE_HEIGHT / 2,
        { duration: 300, zoom: 1 }
      );
    }
  }, [events, nodes, followLatest, setCenter, getAbsolutePosition]);

  const selectedEvent = useMemo(() => {
    if (!selectedEventId) return null;
    return events.find((e) => e.id === selectedEventId) ?? null;
  }, [events, selectedEventId]);

  const selectedNodePosition = useMemo(() => {
    if (!selectedEventId) return null;
    const node = nodes.find((n) => n.id === selectedEventId);
    if (!node) return null;

    const absPos = getAbsolutePosition(node);

    // Convert flow position to screen position
    const screenPos = flowToScreenPosition({
      x: absPos.x + NODE_WIDTH + 20,
      y: absPos.y,
    });

    return screenPos;
  }, [selectedEventId, nodes, flowToScreenPosition, getAbsolutePosition]);

  const handleNodeClick: NodeMouseHandler = useCallback((_event, node) => {
    if (node.type === 'event') {
      setSelectedEventId((prev) => (prev === node.id ? null : node.id));
    }
  }, []);

  const handlePaneClick = useCallback(() => {
    setSelectedEventId(null);
  }, []);

  // Add a placeholder node at the bottom to maintain scroll extent
  const nodesWithPlaceholder = useMemo(() => {
    const placeholder: Node = {
      id: '__scroll-extent__',
      type: 'default',
      position: { x: 0, y: totalHeight },
      data: { label: '' },
      style: { visibility: 'hidden', width: 1, height: 1 },
      selectable: false,
      draggable: false,
    };
    return [...visibleNodes, placeholder];
  }, [visibleNodes, totalHeight]);

  return (
    <div ref={containerRef} style={{ width: '100%', height: '100%', position: 'relative' }}>
      <ReactFlow
        nodes={nodesWithPlaceholder}
        edges={visibleEdges}
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
        elementsSelectable
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
