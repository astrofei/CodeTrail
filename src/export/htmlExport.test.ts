import { describe, expect, it } from 'vitest';
import { createCallAnchor, createCodeNode, createEdge, createEmptyDocument } from '../model/document';
import { generateStaticHtml } from './htmlExport';

describe('HTML export', () => {
  it('embeds the document and viewer behavior in a self-contained HTML file', () => {
    const nodeA = createCodeNode({
      id: 'node_a',
      title: 'A',
      callAnchors: [createCallAnchor({ id: 'anchor_a', label: 'B()', line: 1 })]
    });
    const nodeB = createCodeNode({ id: 'node_b', title: 'B' });
    const document = {
      ...createEmptyDocument('Export test'),
      nodes: [nodeA, nodeB],
      edges: [
        createEdge({
          sourceNodeId: nodeA.id,
          sourceAnchorId: 'anchor_a',
          targetNodeId: nodeB.id
        })
      ]
    };

    const html = generateStaticHtml(document);

    expect(html).toContain('<script id="codetrail-data" type="application/json">');
    expect(html).toContain('"title":"Export test"');
    expect(html).toContain('renderEdges');
    expect(html).toContain('data-collapse');
    expect(html).toContain('anchor_a');
  });
});
