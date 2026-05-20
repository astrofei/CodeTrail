import { Plus, Trash2 } from 'lucide-react';
import {
  createCallAnchor,
  createEdge,
  DEFAULT_EDGE_COLOR,
  DEFAULT_NODE_COLOR,
  DEFAULT_SCOPE_COLOR
} from '../model/document';
import type { CodeNode, CodeTrailDocument, Scope } from '../model/types';

type InspectorProps = {
  document: CodeTrailDocument;
  selectedId: string | null;
  onChange: (document: CodeTrailDocument) => void;
};

function updateNode(document: CodeTrailDocument, node: CodeNode): CodeTrailDocument {
  return {
    ...document,
    nodes: document.nodes.map((item) => (item.id === node.id ? node : item))
  };
}

function updateScope(document: CodeTrailDocument, scope: Scope): CodeTrailDocument {
  return {
    ...document,
    scopes: document.scopes.map((item) => (item.id === scope.id ? scope : item))
  };
}

export function Inspector({ document, selectedId, onChange }: InspectorProps) {
  const selectedNode = document.nodes.find((node) => node.id === selectedId) ?? null;
  const selectedScope = document.scopes.find((scope) => scope.id === selectedId) ?? null;
  const selectedEdge = document.edges.find((edge) => edge.id === selectedId) ?? null;

  if (selectedNode) {
    const setNode = (node: CodeNode) => onChange(updateNode(document, node));

    return (
      <aside className="inspector">
        <h2>Code Node</h2>
        <label>
          Title
          <input
            value={selectedNode.title}
            onChange={(event) => setNode({ ...selectedNode, title: event.target.value })}
          />
        </label>
        <label>
          Language
          <input
            value={selectedNode.language}
            onChange={(event) => setNode({ ...selectedNode, language: event.target.value })}
          />
        </label>
        <label>
          Summary
          <textarea
            rows={3}
            value={selectedNode.summary}
            onChange={(event) => setNode({ ...selectedNode, summary: event.target.value })}
          />
        </label>
        <div className="field-row">
          <label>
            Color
            <input
              type="color"
              value={selectedNode.color || DEFAULT_NODE_COLOR}
              onChange={(event) => setNode({ ...selectedNode, color: event.target.value })}
            />
          </label>
          <label>
            Scope
            <select
              value={selectedNode.scopeId ?? ''}
              onChange={(event) =>
                setNode({ ...selectedNode, scopeId: event.target.value || null })
              }
            >
              <option value="">None</option>
              {document.scopes.map((scope) => (
                <option key={scope.id} value={scope.id}>
                  {scope.title}
                </option>
              ))}
            </select>
          </label>
        </div>
        <label>
          Code Snapshot
          <textarea
            className="code-editor"
            rows={12}
            spellCheck={false}
            value={selectedNode.codeSnapshot}
            onChange={(event) => setNode({ ...selectedNode, codeSnapshot: event.target.value })}
          />
        </label>
        <section className="anchor-panel">
          <div className="section-title">
            <h3>Call Anchors</h3>
            <button
              className="tool-button"
              onClick={() =>
                setNode({
                  ...selectedNode,
                  callAnchors: [...selectedNode.callAnchors, createCallAnchor()]
                })
              }
            >
              <Plus size={15} /> Anchor
            </button>
          </div>
          {selectedNode.callAnchors.map((anchor) => (
            <div className="anchor-editor" key={anchor.id}>
              <input
                aria-label="Anchor label"
                value={anchor.label}
                onChange={(event) =>
                  setNode({
                    ...selectedNode,
                    callAnchors: selectedNode.callAnchors.map((item) =>
                      item.id === anchor.id ? { ...item, label: event.target.value } : item
                    )
                  })
                }
              />
              <input
                aria-label="Line"
                type="number"
                min={1}
                value={anchor.line}
                onChange={(event) =>
                  setNode({
                    ...selectedNode,
                    callAnchors: selectedNode.callAnchors.map((item) =>
                      item.id === anchor.id ? { ...item, line: Number(event.target.value) } : item
                    )
                  })
                }
              />
              <select
                aria-label="Create edge target"
                value=""
                onChange={(event) => {
                  if (!event.target.value) return;
                  onChange({
                    ...document,
                    edges: [
                      ...document.edges,
                      createEdge({
                        sourceNodeId: selectedNode.id,
                        sourceAnchorId: anchor.id,
                        targetNodeId: event.target.value,
                        label: anchor.label,
                        color: DEFAULT_EDGE_COLOR
                      })
                    ]
                  });
                }}
              >
                <option value="">Connect...</option>
                {document.nodes
                  .filter((node) => node.id !== selectedNode.id)
                  .map((node) => (
                    <option key={node.id} value={node.id}>
                      {node.title}
                    </option>
                  ))}
              </select>
              <button
                className="icon-button"
                title="Remove anchor"
                onClick={() =>
                  onChange({
                    ...document,
                    nodes: document.nodes.map((node) =>
                      node.id === selectedNode.id
                        ? {
                            ...node,
                            callAnchors: node.callAnchors.filter((item) => item.id !== anchor.id)
                          }
                        : node
                    ),
                    edges: document.edges.filter((edge) => edge.sourceAnchorId !== anchor.id)
                  })
                }
              >
                <Trash2 size={14} />
              </button>
            </div>
          ))}
        </section>
      </aside>
    );
  }

  if (selectedScope) {
    const setScope = (scope: Scope) => onChange(updateScope(document, scope));
    return (
      <aside className="inspector">
        <h2>Scope</h2>
        <label>
          Title
          <input
            value={selectedScope.title}
            onChange={(event) => setScope({ ...selectedScope, title: event.target.value })}
          />
        </label>
        <label>
          Color
          <input
            type="color"
            value={selectedScope.color || DEFAULT_SCOPE_COLOR}
            onChange={(event) => setScope({ ...selectedScope, color: event.target.value })}
          />
        </label>
        <div className="field-row">
          <label>
            Width
            <input
              type="number"
              min={160}
              value={selectedScope.bounds.width}
              onChange={(event) =>
                setScope({
                  ...selectedScope,
                  bounds: { ...selectedScope.bounds, width: Number(event.target.value) }
                })
              }
            />
          </label>
          <label>
            Height
            <input
              type="number"
              min={120}
              value={selectedScope.bounds.height}
              onChange={(event) =>
                setScope({
                  ...selectedScope,
                  bounds: { ...selectedScope.bounds, height: Number(event.target.value) }
                })
              }
            />
          </label>
        </div>
      </aside>
    );
  }

  if (selectedEdge) {
    return (
      <aside className="inspector">
        <h2>Edge</h2>
        <label>
          Label
          <input
            value={selectedEdge.label}
            onChange={(event) =>
              onChange({
                ...document,
                edges: document.edges.map((edge) =>
                  edge.id === selectedEdge.id ? { ...edge, label: event.target.value } : edge
                )
              })
            }
          />
        </label>
        <label>
          Color
          <input
            type="color"
            value={selectedEdge.color || DEFAULT_EDGE_COLOR}
            onChange={(event) =>
              onChange({
                ...document,
                edges: document.edges.map((edge) =>
                  edge.id === selectedEdge.id ? { ...edge, color: event.target.value } : edge
                )
              })
            }
          />
        </label>
      </aside>
    );
  }

  return (
    <aside className="inspector empty">
      <h2>Inspector</h2>
      <p>Select a code node, scope, or edge to edit its details.</p>
    </aside>
  );
}
