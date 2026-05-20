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
import { toggleNodeCollapsed } from './operations';

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
});
