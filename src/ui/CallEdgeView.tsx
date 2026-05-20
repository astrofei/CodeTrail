import { BaseEdge, EdgeLabelRenderer, EdgeProps, getBezierPath } from '@xyflow/react';

type Point = {
  x: number;
  y: number;
};

function buildReadablePath(
  source: Point,
  target: Point
): { path: string; labelX: number; labelY: number; labelClassName: string } {
  const dx = target.x - source.x;
  const dy = target.y - source.y;
  const distance = Math.hypot(dx, dy);

  if (distance < 220) {
    const midX = (source.x + target.x) / 2;
    const midY = (source.y + target.y) / 2;
    const controlOffset = Math.max(16, Math.min(40, distance * 0.22));
    const controlX = midX + (dy === 0 ? 0 : Math.sign(dy) * controlOffset);
    const controlY = midY - controlOffset;
    return {
      path: `M ${source.x},${source.y} Q ${controlX},${controlY} ${target.x},${target.y}`,
      labelX: controlX,
      labelY: controlY,
      labelClassName: 'edge-label edge-label--compact'
    };
  }

  const [path, labelX, labelY] = getBezierPath({
    sourceX: source.x,
    sourceY: source.y,
    targetX: target.x,
    targetY: target.y
  });
  return { path, labelX, labelY, labelClassName: 'edge-label' };
}

export function CallEdgeView({
  id,
  label,
  markerEnd,
  selected,
  sourceX,
  sourceY,
  style,
  targetX,
  targetY
}: EdgeProps) {
  const { labelClassName, labelX, labelY, path } = buildReadablePath(
    { x: sourceX, y: sourceY },
    { x: targetX, y: targetY }
  );

  return (
    <>
      <BaseEdge
        id={id}
        markerEnd={markerEnd}
        path={path}
        style={{
          ...style,
          strokeWidth: selected ? 4 : 2.5
        }}
      />
      {label && (
        <EdgeLabelRenderer>
          <div
            className={labelClassName}
            style={{
              transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`
            }}
          >
            {label}
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  );
}
