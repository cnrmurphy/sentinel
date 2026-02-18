import { memo } from 'react';
import { Handle, Position } from '@xyflow/react';

export interface ActivityNodeData extends Record<string, unknown> {
  phase: string;
}

const PHASE_LABELS: Record<string, string> = {
  thinking: 'thinking...',
  writing: 'writing...',
  tool_use: 'calling tool...',
  tool_execution: 'executing tool...',
};

interface ActivityNodeProps {
  data: ActivityNodeData;
}

function ActivityNodeComponent({ data }: ActivityNodeProps) {
  const label = PHASE_LABELS[data.phase] ?? data.phase;

  return (
    <>
      <Handle type="target" position={Position.Top} style={{ visibility: 'hidden' }} />
      <div
        className="activity-node"
        style={{
          padding: '8px 16px',
          backgroundColor: 'rgba(99, 102, 241, 0.1)',
          border: '1px solid rgba(99, 102, 241, 0.4)',
          borderRadius: '16px',
          fontFamily: 'monospace',
          fontSize: '12px',
          color: '#818cf8',
          width: 'fit-content',
          animation: 'pulse 2s ease-in-out infinite',
        }}
      >
        {label}
      </div>
      <Handle type="source" position={Position.Bottom} style={{ visibility: 'hidden' }} />
    </>
  );
}

export const ActivityNode = memo(ActivityNodeComponent);
