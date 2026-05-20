import type { CodeNode, CodeTrailDocument, CodeTrailEdge, Scope } from './types';
import { touchDocument } from './document';

function isSelectionAnchor(anchor: CodeNode['callAnchors'][number]): boolean {
  return anchor.id.startsWith('selection_anchor_') && Boolean(anchor.selectedText);
}

function selectionAnchorStillExists(node: CodeNode, anchor: CodeNode['callAnchors'][number]): boolean {
  if (!isSelectionAnchor(anchor) || !anchor.selectedText) {
    return true;
  }

  return node.codeSnapshot.includes(anchor.selectedText);
}

export function upsertNode(document: CodeTrailDocument, node: CodeNode): CodeTrailDocument {
  const exists = document.nodes.some((item) => item.id === node.id);
  return touchDocument({
    ...document,
    nodes: exists
      ? document.nodes.map((item) => (item.id === node.id ? node : item))
      : [...document.nodes, node]
  });
}

export function upsertScope(document: CodeTrailDocument, scope: Scope): CodeTrailDocument {
  const exists = document.scopes.some((item) => item.id === scope.id);
  return touchDocument({
    ...document,
    scopes: exists
      ? document.scopes.map((item) => (item.id === scope.id ? scope : item))
      : [...document.scopes, scope]
  });
}

export function upsertEdge(document: CodeTrailDocument, edge: CodeTrailEdge): CodeTrailDocument {
  const exists = document.edges.some((item) => item.id === edge.id);
  return touchDocument({
    ...document,
    edges: exists
      ? document.edges.map((item) => (item.id === edge.id ? edge : item))
      : [...document.edges, edge]
  });
}

export function removeNode(document: CodeTrailDocument, nodeId: string): CodeTrailDocument {
  return touchDocument({
    ...document,
    nodes: document.nodes.filter((node) => node.id !== nodeId),
    edges: document.edges.filter((edge) => edge.sourceNodeId !== nodeId && edge.targetNodeId !== nodeId)
  });
}

export function toggleNodeCollapsed(document: CodeTrailDocument, nodeId: string): CodeTrailDocument {
  return touchDocument({
    ...document,
    nodes: document.nodes.map((node) =>
      node.id === nodeId ? { ...node, collapsed: !node.collapsed } : node
    )
  });
}

export function assignNodeScope(
  document: CodeTrailDocument,
  nodeId: string,
  scopeId: string | null
): CodeTrailDocument {
  return touchDocument({
    ...document,
    nodes: document.nodes.map((node) => (node.id === nodeId ? { ...node, scopeId } : node))
  });
}

export function pruneMissingSelectionAnchors(document: CodeTrailDocument, nodeId: string): CodeTrailDocument {
  const sourceNode = document.nodes.find((node) => node.id === nodeId);
  if (!sourceNode) {
    return document;
  }

  const staleAnchorIds = new Set(
    sourceNode.callAnchors
      .filter((anchor) => !selectionAnchorStillExists(sourceNode, anchor))
      .map((anchor) => anchor.id)
  );

  if (staleAnchorIds.size === 0) {
    return document;
  }

  return touchDocument({
    ...document,
    nodes: document.nodes.map((node) =>
      node.id === sourceNode.id
        ? {
            ...node,
            callAnchors: node.callAnchors.filter((anchor) => !staleAnchorIds.has(anchor.id))
          }
        : node
    ),
    edges: document.edges.filter(
      (edge) => edge.sourceNodeId !== sourceNode.id || !staleAnchorIds.has(edge.sourceAnchorId)
    )
  });
}
