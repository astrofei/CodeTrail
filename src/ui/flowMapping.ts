import type { Edge, Node } from '@xyflow/react';
import type { CallAnchor, CodeNode, CodeTrailDocument, CodeTrailEdge, Scope } from '../model/types';

export type ResizeHandler = (id: string, width: number, height: number, x?: number, y?: number) => void;
export type SelectedCodeAnchor = Pick<CallAnchor, 'label' | 'line' | 'startColumn' | 'endColumn' | 'selectedText'>;

const COLLAPSED_MIN_WIDTH = 280;
const COLLAPSED_MAX_WIDTH = 520;
const COLLAPSED_HEADER_HEIGHT = 72;
const COLLAPSED_SUMMARY_VERTICAL_PADDING = 28;
const COLLAPSED_SUMMARY_LINE_HEIGHT = 22;
const COLLAPSED_BOTTOM_PADDING = 14;
const COLLAPSED_HORIZONTAL_PADDING = 32;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function wrappedLineCount(value: string, charactersPerLine: number): number {
  return value.split('\n').reduce((total, line) => {
    const length = Math.max(1, line.length);
    return total + Math.max(1, Math.ceil(length / charactersPerLine));
  }, 0);
}

function collapsedNodeWidth(node: CodeNode): number {
  const longestSummaryLine = Math.max(0, ...node.summary.split('\n').map((line) => line.length));
  const longestAnchorLabel = Math.max(0, ...node.callAnchors.map((anchor) => anchor.label.length));
  const titleWidth = 130 + node.title.length * 9;
  const summaryWidth = COLLAPSED_HORIZONTAL_PADDING + longestSummaryLine * 8;
  const anchorWidth = 88 + longestAnchorLabel * 8;

  return clamp(
    Math.ceil(Math.max(titleWidth, summaryWidth, anchorWidth)),
    COLLAPSED_MIN_WIDTH,
    COLLAPSED_MAX_WIDTH
  );
}

function collapsedNodeHeight(node: CodeNode, width: number): number {
  const summaryCharactersPerLine = Math.max(20, Math.floor((width - COLLAPSED_HORIZONTAL_PADDING) / 8));
  const summaryLineCount = wrappedLineCount(node.summary || ' ', summaryCharactersPerLine);

  return Math.ceil(
    COLLAPSED_HEADER_HEIGHT +
      summaryLineCount * COLLAPSED_SUMMARY_LINE_HEIGHT +
      COLLAPSED_SUMMARY_VERTICAL_PADDING +
      COLLAPSED_BOTTOM_PADDING
  );
}

export type CodeNodeData = {
  codeNode: CodeNode;
  connectionCount: number;
  scopes: Scope[];
  connectableNodes: Array<{ id: string; title: string }>;
  scopeTitle: string | null;
  selected: boolean;
  focused: boolean;
  connectedSourceAnchorIds: string[];
  onSelect: (id: string) => void;
  onFocus: (id: string) => void;
  onToggle: (id: string) => void;
  onResize: ResizeHandler;
  onUpdate: (node: CodeNode) => void;
  onCreateSelectionAnchor: (sourceNode: CodeNode, selection: SelectedCodeAnchor) => void;
  onRemoveCallAnchor: (sourceNodeId: string, anchorId: string) => void;
  onCreateNodeFromSelection: (sourceNode: CodeNode, selection: SelectedCodeAnchor) => void;
  onConnectSelectionToNode: (sourceNode: CodeNode, selection: SelectedCodeAnchor, targetNodeId: string) => void;
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
  onCreateSelectionAnchor: (sourceNode: CodeNode, selection: SelectedCodeAnchor) => void,
  onRemoveCallAnchor: (sourceNodeId: string, anchorId: string) => void,
  onCreateNodeFromSelection: (sourceNode: CodeNode, selection: SelectedCodeAnchor) => void,
  onConnectSelectionToNode: (sourceNode: CodeNode, selection: SelectedCodeAnchor, targetNodeId: string) => void,
  onDeleteEdge: (edgeId: string) => void,
  onSelect: (id: string) => void,
  onFocus: (id: string) => void,
  selectedId: string | null,
  focusedId: string | null
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

  const codeNodes: Node<CodeNodeData>[] = document.nodes.map((node) => {
    const collapsedWidth = node.collapsed ? collapsedNodeWidth(node) : node.size.width;
    return {
      id: node.id,
      type: 'code',
      position: node.position,
      data: {
        codeNode: node,
        connectionCount: document.edges.filter(
          (edge) => edge.sourceNodeId === node.id || edge.targetNodeId === node.id
        ).length,
        scopes: document.scopes,
        connectableNodes: document.nodes.map((item) => ({ id: item.id, title: item.title })),
        scopeTitle: document.scopes.find((scope) => scope.id === node.scopeId)?.title ?? null,
        selected: selectedId === node.id,
        focused: focusedId === node.id,
        connectedSourceAnchorIds: document.edges
          .filter((edge) => edge.sourceNodeId === node.id)
          .map((edge) => edge.sourceAnchorId),
        onSelect,
        onFocus,
        onToggle,
        onResize,
        onUpdate,
        onCreateSelectionAnchor,
        onRemoveCallAnchor,
        onCreateNodeFromSelection,
        onConnectSelectionToNode
      },
      style: {
        width: collapsedWidth,
        height: node.collapsed ? collapsedNodeHeight(node, collapsedWidth) : node.size.height,
        zIndex: 10
      }
    };
  });

  return [...scopeNodes, ...codeNodes];
}

export function toFlowEdges(document: CodeTrailDocument, onDeleteEdge?: (edgeId: string) => void): Edge[] {
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
      onDeleteEdge,
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
