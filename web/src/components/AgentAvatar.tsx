interface AgentAvatarProps {
  name: string;
  size?: number;
}

function hashString(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) - hash) + str.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash);
}

export function AgentAvatar({ name, size = 48 }: AgentAvatarProps) {
  const hash = hashString(name);
  const hue = hash % 360;
  const bg = `hsl(${hue}, 50%, 20%)`;
  const fg = `hsl(${hue}, 70%, 60%)`;

  // 6 bits determine which cells are filled in a 3x3 mirrored grid
  const bits = hash >> 8;

  const cellSize = size / 5;
  const offset = cellSize;
  const rects: { x: number; y: number }[] = [];

  for (let row = 0; row < 3; row++) {
    const leftOn = Boolean(bits & (1 << (row * 2)));
    const centerOn = Boolean(bits & (1 << (row * 2 + 1)));

    if (leftOn) {
      rects.push({ x: offset, y: offset + row * cellSize });
      rects.push({ x: offset + 2 * cellSize, y: offset + row * cellSize }); // mirror
    }
    if (centerOn) {
      rects.push({ x: offset + cellSize, y: offset + row * cellSize });
    }
  }

  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      style={{ borderRadius: '8px', flexShrink: 0 }}
    >
      <rect width={size} height={size} fill={bg} rx="8" />
      {rects.map((r, i) => (
        <rect
          key={i}
          x={r.x}
          y={r.y}
          width={cellSize}
          height={cellSize}
          fill={fg}
          rx="2"
        />
      ))}
    </svg>
  );
}
