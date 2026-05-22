import { memo, useState } from 'react';
import type { CSSProperties } from 'react';
import { NodeProps, NodeResizer } from '@xyflow/react';
import { MessageSquarePlus } from 'lucide-react';
import type { ScopeNodeData } from './flowMapping';

export const ScopeNodeView = memo(function ScopeNodeView({ data, selected }: NodeProps) {
  const { onResize, onSelect, onUpdate, scope } = data as ScopeNodeData;
  const isSelected = selected || (data as ScopeNodeData).selected;
  const [editingDescription, setEditingDescription] = useState(false);

  return (
    <section
      className={`scope-node ${isSelected ? 'is-selected' : ''}`}
      style={{ '--scope-color': scope.color } as CSSProperties}
      onClick={(event) => {
        event.stopPropagation();
        onSelect(scope.id);
      }}
    >
      <NodeResizer
        isVisible={isSelected}
        minWidth={220}
        minHeight={160}
        onResizeEnd={(_, params) =>
          onResize(scope.id, params.width, params.height, params.x, params.y)
        }
      />
      <div className="scope-node__label">
        <strong>{scope.title}</strong>
        {isSelected ? (
          <label className="scope-node__color-button nodrag" title="Scope color" aria-label={`${scope.title} color`}>
            <input
              type="color"
              value={scope.color}
              onClick={(event) => event.stopPropagation()}
              onChange={(event) => onUpdate({ ...scope, color: event.target.value })}
            />
          </label>
        ) : null}
        <button
          className="scope-node__note-button nodrag"
          title="Add scope note"
          aria-label={`Add note for ${scope.title}`}
          onClick={(event) => {
            event.stopPropagation();
            setEditingDescription(true);
          }}
        >
          <MessageSquarePlus size={13} />
        </button>
      </div>
      {editingDescription || scope.description ? (
        <textarea
          className="scope-node__description nodrag"
          aria-label={`${scope.title} description`}
          placeholder="Describe this scope..."
          defaultValue={scope.description ?? ''}
          autoFocus={editingDescription}
          rows={2}
          onClick={(event) => event.stopPropagation()}
          onBlur={(event) => {
            onUpdate({ ...scope, description: event.target.value });
            setEditingDescription(false);
          }}
          onKeyDown={(event) => {
            if (event.key === 'Escape') {
              setEditingDescription(false);
            }
          }}
        />
      ) : null}
    </section>
  );
});
