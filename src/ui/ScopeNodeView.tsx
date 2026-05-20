import { memo } from 'react';
import type { CSSProperties } from 'react';
import { NodeProps, NodeResizer } from '@xyflow/react';
import type { ScopeNodeData } from './flowMapping';

export const ScopeNodeView = memo(function ScopeNodeView({ data, selected }: NodeProps) {
  const { onResize, scope } = data as ScopeNodeData;

  return (
    <section
      className={`scope-node ${selected ? 'is-selected' : ''}`}
      style={{ '--scope-color': scope.color } as CSSProperties}
    >
      <NodeResizer
        isVisible={selected}
        minWidth={220}
        minHeight={160}
        onResizeEnd={(_, params) =>
          onResize(scope.id, params.width, params.height, params.x, params.y)
        }
      />
      <strong className="scope-node__title">{scope.title}</strong>
    </section>
  );
});
