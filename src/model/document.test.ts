import { describe, expect, it } from 'vitest';
import {
  createCallAnchor,
  createCodeNode,
  createEdge,
  createEmptyDocument,
  createScope,
  parseDocument,
  serializeDocument,
  validateDocument
} from './document';
import { pruneMissingSelectionAnchors, toggleNodeCollapsed } from './operations';

describe('CodeTrail document model', () => {
  it('validates a node, scope, and call-anchor edge', () => {
    const scope = createScope({ id: 'scope_a' });
    const nodeA = createCodeNode({
      id: 'node_a',
      scopeId: scope.id,
      callAnchors: [createCallAnchor({ id: 'anchor_a', label: 'b()', line: 2 })]
    });
    const nodeB = createCodeNode({ id: 'node_b' });
    const document = {
      ...createEmptyDocument(),
      scopes: [scope],
      nodes: [nodeA, nodeB],
      edges: [
        createEdge({
          sourceNodeId: nodeA.id,
          sourceAnchorId: 'anchor_a',
          targetNodeId: nodeB.id
        })
      ]
    };

    expect(validateDocument(document)).toEqual({ valid: true, errors: [] });
  });

  it('rejects an edge without an existing source call anchor', () => {
    const nodeA = createCodeNode({ id: 'node_a' });
    const nodeB = createCodeNode({ id: 'node_b' });
    const document = {
      ...createEmptyDocument(),
      nodes: [nodeA, nodeB],
      edges: [
        createEdge({
          sourceNodeId: nodeA.id,
          sourceAnchorId: 'missing_anchor',
          targetNodeId: nodeB.id
        })
      ]
    };

    const result = validateDocument(document);
    expect(result.valid).toBe(false);
    expect(result.errors.join('\n')).toContain('missing call anchor');
  });

  it('preserves collapsed state through serialization', () => {
    const node = createCodeNode({ id: 'node_a', collapsed: false });
    const document = { ...createEmptyDocument(), nodes: [node] };
    const collapsed = toggleNodeCollapsed(document, node.id);
    const parsed = parseDocument(serializeDocument(collapsed));

    expect(parsed.nodes[0].collapsed).toBe(true);
  });

  it('removes generated selection edges when the source text disappears but keeps target nodes', () => {
    const nodeA = createCodeNode({
      id: 'node_a',
      codeSnapshot: 'function entry() {\n  B.work();\n}',
      callAnchors: [
        createCallAnchor({
          id: 'selection_anchor_a',
          label: 'B.work();',
          line: 2,
          startColumn: 2,
          endColumn: 11,
          selectedText: 'B.work();'
        })
      ]
    });
    const nodeB = createCodeNode({ id: 'node_b' });
    const document = {
      ...createEmptyDocument(),
      nodes: [{ ...nodeA, codeSnapshot: 'function entry() {\n  return true;\n}' }, nodeB],
      edges: [
        createEdge({
          sourceNodeId: nodeA.id,
          sourceAnchorId: 'selection_anchor_a',
          targetNodeId: nodeB.id
        })
      ]
    };

    const pruned = pruneMissingSelectionAnchors(document, nodeA.id);

    expect(pruned.nodes.map((node) => node.id)).toEqual(['node_a', 'node_b']);
    expect(pruned.nodes[0].callAnchors).toEqual([]);
    expect(pruned.edges).toEqual([]);
  });
});
