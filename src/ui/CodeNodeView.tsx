import { memo, useState } from 'react';
import type { CSSProperties } from 'react';
import { Handle, NodeProps, NodeResizer, Position } from '@xyflow/react';
import { ChevronDown, ChevronRight, Plus } from 'lucide-react';
import type { CodeNodeData } from './flowMapping';

const LANGUAGE_OPTIONS = ['typescript', 'javascript', 'c++', 'c', 'kotlin', 'java', 'rust', 'python', 'go', 'swift'];

function anchorByLine(data: CodeNodeData, line: number) {
  return data.codeNode.callAnchors.filter((anchor) => anchor.line === line);
}

export const CodeNodeView = memo(function CodeNodeView({ data, selected }: NodeProps) {
  const nodeData = data as CodeNodeData;
  const { codeNode, onCreateNodeFromSelection, onResize, onSelect, onToggle, onUpdate, scopeTitle } = nodeData;
  const isSelected = selected || nodeData.selected;
  const lines = codeNode.codeSnapshot.split('\n');
  const [editing, setEditing] = useState<'title' | 'summary' | 'code' | null>(null);
  const [selectedCode, setSelectedCode] = useState('');

  const commitText = (field: 'title' | 'summary' | 'codeSnapshot', value: string) => {
    onUpdate({ ...codeNode, [field]: value });
    setEditing(null);
  };

  const captureSelectedCode = () => {
    const text = window.getSelection()?.toString().trim() ?? '';
    setSelectedCode(text.length > 0 ? text : '');
  };

  return (
    <section
      className={`code-node ${isSelected ? 'is-selected' : ''}`}
      style={{ '--node-color': codeNode.color } as CSSProperties}
      onClick={(event) => {
        event.stopPropagation();
        onSelect(codeNode.id);
      }}
    >
      <NodeResizer
        isVisible={isSelected && !codeNode.collapsed}
        minWidth={260}
        minHeight={120}
        onResizeEnd={(_, params) =>
          onResize(codeNode.id, params.width, params.height, params.x, params.y)
        }
      />
      <Handle id="target" type="target" position={Position.Left} className="target-handle" />
      <header className="code-node__header">
        <button
          className="icon-button"
          title={codeNode.collapsed ? 'Expand node' : 'Collapse node'}
          onClick={(event) => {
            event.stopPropagation();
            onToggle(codeNode.id);
          }}
        >
          {codeNode.collapsed ? <ChevronRight size={16} /> : <ChevronDown size={16} />}
        </button>
        <div className="code-node__title-wrap">
          {editing === 'title' ? (
            <input
              className="inline-title-input nodrag"
              autoFocus
              defaultValue={codeNode.title}
              onBlur={(event) => commitText('title', event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  commitText('title', event.currentTarget.value);
                }
                if (event.key === 'Escape') {
                  setEditing(null);
                }
              }}
            />
          ) : (
            <strong onDoubleClick={() => setEditing('title')}>{codeNode.title}</strong>
          )}
          <span>{scopeTitle ? `${scopeTitle} - ${codeNode.language}` : codeNode.language}</span>
        </div>
        <span className="code-node__count">{codeNode.callAnchors.length}</span>
      </header>
      {isSelected && (
        <div className="node-property-strip nodrag">
          <select
            title="Language"
            value={codeNode.language}
            onChange={(event) => onUpdate({ ...codeNode, language: event.target.value })}
          >
            {LANGUAGE_OPTIONS.map((language) => (
              <option key={language} value={language}>
                {language}
              </option>
            ))}
          </select>
          <input
            title="Node color"
            type="color"
            value={codeNode.color}
            onChange={(event) => onUpdate({ ...codeNode, color: event.target.value })}
          />
        </div>
      )}
      {editing === 'summary' ? (
        <textarea
          className="inline-summary-input nodrag"
          autoFocus
          defaultValue={codeNode.summary}
          rows={3}
          onBlur={(event) => commitText('summary', event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Escape') {
              setEditing(null);
            }
          }}
        />
      ) : (
        <p className="code-node__summary" onDoubleClick={() => setEditing('summary')}>
          {codeNode.summary || 'No summary yet.'}
        </p>
      )}
      {codeNode.collapsed && codeNode.callAnchors.length > 0 && (
        <div className="collapsed-anchors" aria-label="Collapsed call anchors">
          {codeNode.callAnchors.map((anchor) => (
            <span key={anchor.id} className="collapsed-anchor">
              <Handle
                id={anchor.id}
                type="source"
                position={Position.Right}
                className="collapsed-anchor__handle"
              />
              {anchor.label}
            </span>
          ))}
        </div>
      )}
      {!codeNode.collapsed && (
        editing === 'code' ? (
          <textarea
            className="code-node__code code-node__textarea nodrag"
            autoFocus
            spellCheck={false}
            defaultValue={codeNode.codeSnapshot}
            onBlur={(event) => commitText('codeSnapshot', event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Escape') {
                setEditing(null);
              }
            }}
          />
        ) : (
          <div className="code-node__code-wrap">
            {selectedCode && (
              <button
                className="selection-add-button nodrag"
                title="Create node from selected code"
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => {
                  onCreateNodeFromSelection(codeNode, selectedCode);
                  setSelectedCode('');
                  window.getSelection()?.removeAllRanges();
                }}
              >
                <Plus size={15} />
              </button>
            )}
            <pre
              className="code-node__code"
              onMouseUp={captureSelectedCode}
              onDoubleClick={() => setEditing('code')}
            >
              {lines.map((line, index) => {
                const lineNo = index + 1;
                const anchors = anchorByLine(data as CodeNodeData, lineNo);
                return (
                  <span key={lineNo} className={`code-line ${anchors.length ? 'has-anchor' : ''}`}>
                    <span className="code-line__number">{lineNo}</span>
                    <span className="code-line__text">{line || ' '}</span>
                    {anchors.map((anchor) => (
                      <span key={anchor.id} className="call-anchor">
                        <Handle
                          id={anchor.id}
                          type="source"
                          position={Position.Right}
                          className="call-anchor__handle"
                        />
                        {anchor.label}
                      </span>
                    ))}
                  </span>
                );
              })}
            </pre>
          </div>
        )
      )}
    </section>
  );
});
