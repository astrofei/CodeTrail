import type { CodeNode, CodeTrailDocument, CodeTrailEdge, Scope } from './types';
import { touchDocument } from './document';

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
