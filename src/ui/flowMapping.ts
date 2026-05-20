import type { Edge, Node } from '@xyflow/react';
import type { CodeNode, CodeTrailDocument, CodeTrailEdge, Scope } from '../model/types';

export type ResizeHandler = (id: string, width: number, height: number, x?: number, y?: number) => void;

const COLLAPSED_BASE_HEIGHT = 112;
const COLLAPSED_ANCHOR_ROW_HEIGHT = 30;

function collapsedNodeHeight(node: CodeNode): number {
  if (node.callAnchors.length === 0) {
    return COLLAPSED_BASE_HEIGHT;
  }
  return COLLAPSED_BASE_HEIGHT + Math.ceil(node.callAnchors.length / 3) * COLLAPSED_ANCHOR_ROW_HEIGHT;
}

export type CodeNodeData = {
  codeNode: CodeNode;
  scopes: Scope[];
  scopeTitle: string | null;
  selected: boolean;
  onSelect: (id: string) => void;
  onToggle: (id: string) => void;
  onResize: ResizeHandler;
  onUpdate: (node: CodeNode) => void;
  onCreateNodeFromSelection: (sourceNode: CodeNode, selectedCode: string) => void;
};

export type ScopeNodeData = {
  scope: Scope;
  onResize: ResizeHandler;
};

export function toFlowNodes(
  document: CodeTrailDocument,
  onToggle: (id: string) => void,
  onResize: ResizeHandler,
  onUpdate: (node: CodeNode) => void,
  onCreateNodeFromSelection: (sourceNode: CodeNode, selectedCode: string) => void,
  onSelect: (id: string) => void,
  selectedId: string | null
): Node[] {
  const scopeNodes: Node<ScopeNodeData>[] = document.scopes.map((scope) => ({
    id: scope.id,
    type: 'scope',
    position: { x: scope.bounds.x, y: scope.bounds.y },
    data: { scope, onResize },
    draggable: true,
    selectable: true,
    style: {
      width: scope.bounds.width,
      height: scope.bounds.height,
      zIndex: 0
    }
  }));

  const codeNodes: Node<CodeNodeData>[] = document.nodes.map((node) => ({
    id: node.id,
    type: 'code',
    position: node.position,
    data: {
      codeNode: node,
      scopes: document.scopes,
      scopeTitle: document.scopes.find((scope) => scope.id === node.scopeId)?.title ?? null,
      selected: selectedId === node.id,
      onSelect,
      onToggle,
      onResize,
      onUpdate,
      onCreateNodeFromSelection
    },
    style: {
      width: node.size.width,
      height: node.collapsed ? collapsedNodeHeight(node) : node.size.height,
      zIndex: 10
    }
  }));

  return [...scopeNodes, ...codeNodes];
}

export function toFlowEdges(document: CodeTrailDocument): Edge[] {
  return document.edges.map((edge) => ({
    id: edge.id,
    source: edge.sourceNodeId,
    sourceHandle: edge.sourceAnchorId,
    target: edge.targetNodeId,
    targetHandle: 'target',
    label: edge.label || undefined,
    type: 'call',
    animated: false,
    style: { stroke: edge.color, strokeWidth: 2.5 },
    markerEnd: { type: 'arrowclosed', color: edge.color },
    zIndex: 50,
    data: {
      codeTrailEdge: edge,
      sourceNode: document.nodes.find((node) => node.id === edge.sourceNodeId) ?? null,
      targetNode: document.nodes.find((node) => node.id === edge.targetNodeId) ?? null
    }
  }));
}

export function updatePositionsFromFlowNodes(
  document: CodeTrailDocument,
  flowNodes: Node[]
): CodeTrailDocument {
  const positions = new Map(flowNodes.map((node) => [node.id, node.position]));
  return {
    ...document,
    nodes: document.nodes.map((node) => ({
      ...node,
      position: positions.get(node.id) ?? node.position
    })),
    scopes: document.scopes.map((scope) => {
      const position = positions.get(scope.id);
      return position
        ? { ...scope, bounds: { ...scope.bounds, x: position.x, y: position.y } }
        : scope;
    })
  };
}

function readNodeDimension(node: Node, key: 'width' | 'height', fallback: number): number {
  const direct = (node as Node & { width?: number; height?: number })[key];
  const measured = node.measured?.[key];
  const styled = node.style?.[key];
  const numericStyled = typeof styled === 'number' ? styled : Number.parseFloat(String(styled));
  return direct ?? measured ?? (Number.isFinite(numericStyled) ? numericStyled : fallback);
}

export function updateGeometryFromFlowNodes(
  document: CodeTrailDocument,
  flowNodes: Node[]
): CodeTrailDocument {
  const nodesById = new Map(flowNodes.map((node) => [node.id, node]));
  return {
    ...document,
    nodes: document.nodes.map((node) => {
      const flowNode = nodesById.get(node.id);
      return flowNode
        ? {
            ...node,
            position: flowNode.position,
            size: node.collapsed
              ? node.size
              : {
                  width: readNodeDimension(flowNode, 'width', node.size.width),
                  height: readNodeDimension(flowNode, 'height', node.size.height)
                }
          }
        : node;
    }),
    scopes: document.scopes.map((scope) => {
      const flowNode = nodesById.get(scope.id);
      return flowNode
        ? {
            ...scope,
            bounds: {
              x: flowNode.position.x,
              y: flowNode.position.y,
              width: readNodeDimension(flowNode, 'width', scope.bounds.width),
              height: readNodeDimension(flowNode, 'height', scope.bounds.height)
            }
          }
        : scope;
    })
  };
}

export function fromFlowEdge(edge: Edge): CodeTrailEdge | null {
  if (!edge.source || !edge.sourceHandle || !edge.target) {
    return null;
  }
  return {
    id: edge.id,
    sourceNodeId: edge.source,
    sourceAnchorId: edge.sourceHandle,
    targetNodeId: edge.target,
    label: typeof edge.label === 'string' ? edge.label : '',
    color: typeof edge.style?.stroke === 'string' ? edge.style.stroke : '#2563eb'
  };
}
