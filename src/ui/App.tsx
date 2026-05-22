import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  Background,
  Controls,
  MiniMap,
  Node,
  OnConnect,
  OnSelectionChangeParams,
  ReactFlow,
  ReactFlowProvider,
  useEdgesState,
  useNodesState,
  useReactFlow
} from '@xyflow/react';
import { Download, FileDown, FilePlus2, FolderOpen, Save, SquareCode } from 'lucide-react';
import {
  createCallAnchor,
  createCodeNode,
  createEdge,
  createEmptyDocument,
  createScope,
  newId,
  parseDocument,
  serializeDocument,
  validateDocument
} from '../model/document';
import type { CallAnchor, CodeTrailDocument } from '../model/types';
import { pruneMissingSelectionAnchors } from '../model/operations';
import { generateStaticHtml } from '../export/htmlExport';
import { openProjectNative, overwriteTextNative, saveTextNative } from '../platform/files';
import { CodeNodeView } from './CodeNodeView';
import { ScopeNodeView } from './ScopeNodeView';
import { CallEdgeView } from './CallEdgeView';
import { toFlowEdges, toFlowNodes, updateGeometryFromFlowNodes } from './flowMapping';
import type { SelectedCodeAnchor } from './flowMapping';

const nodeTypes = {
  code: CodeNodeView,
  scope: ScopeNodeView
};

const edgeTypes = {
  call: CallEdgeView
};

type Rect = {
  x: number;
  y: number;
  width: number;
  height: number;
};

const SCOPE_PADDING = 24;
const SCOPE_TITLE_SPACE = 44;

type ScopeDragState = {
  scopeId: string;
  startPosition: { x: number; y: number };
  memberPositions: Array<{
    id: string;
    position: { x: number; y: number };
  }>;
};

function intersects(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
}

function includeRect(bounds: Rect, child: Rect, padding = SCOPE_PADDING): Rect {
  const left = Math.min(bounds.x, child.x - padding);
  const top = Math.min(bounds.y, child.y - padding);
  const right = Math.max(bounds.x + bounds.width, child.x + child.width + padding);
  const bottom = Math.max(bounds.y + bounds.height, child.y + child.height + padding);
  return {
    x: left,
    y: top,
    width: right - left,
    height: bottom - top
  };
}

function boundsForRects(rects: Rect[], padding = SCOPE_PADDING): Rect | null {
  if (rects.length === 0) {
    return null;
  }

  const left = Math.min(...rects.map((rect) => rect.x)) - padding;
  const top = Math.min(...rects.map((rect) => rect.y)) - padding - SCOPE_TITLE_SPACE;
  const right = Math.max(...rects.map((rect) => rect.x + rect.width)) + padding;
  const bottom = Math.max(...rects.map((rect) => rect.y + rect.height)) + padding;

  return {
    x: left,
    y: top,
    width: Math.max(220, right - left),
    height: Math.max(160, bottom - top)
  };
}

function numericDimension(value: unknown, fallback: number): number {
  const parsed = typeof value === 'number' ? value : Number.parseFloat(String(value));
  return Number.isFinite(parsed) ? parsed : fallback;
}

function isEventInsideFocusedNode(target: EventTarget | null): boolean {
  return target instanceof Element && Boolean(target.closest('.code-node.is-focused'));
}

function scrollFocusedCodePanel(deltaX: number, deltaY: number): void {
  const panel = window.document.querySelector('.code-node.is-focused .code-node__code-panel');
  if (panel instanceof HTMLElement) {
    panel.scrollBy({ left: deltaX, top: deltaY, behavior: 'auto' });
  }
}

function hasUsableFlowViewport(): boolean {
  const bounds = window.document.querySelector('.react-flow')?.getBoundingClientRect();
  return Boolean(bounds && bounds.width > 0 && bounds.height > 0);
}

function recomputeScopeBounds(document: CodeTrailDocument, scopeId: string): CodeTrailDocument {
  const assignedRects = document.nodes
    .filter((node) => node.scopeId === scopeId)
    .map((node) => ({
      x: node.position.x,
      y: node.position.y,
      width: node.size.width,
      height: node.size.height
    }));
  const nextBounds = boundsForRects(assignedRects);

  if (!nextBounds) {
    return document;
  }

  return {
    ...document,
    scopes: document.scopes.map((scope) =>
      scope.id === scopeId ? { ...scope, bounds: nextBounds } : scope
    )
  };
}

function createAnchorFromSelection(selection: SelectedCodeAnchor): CallAnchor {
  return createCallAnchor({
    id: newId('selection_anchor'),
    label: selection.label,
    line: selection.line,
    startColumn: selection.startColumn,
    endColumn: selection.endColumn,
    selectedText: selection.selectedText
  });
}

function inferTitleFromSelectedCode(selectedCode: string): string {
  const controlWords = new Set(['catch', 'for', 'if', 'switch', 'while']);

  for (const rawLine of selectedCode.split('\n')) {
    const line = rawLine
      .replace(/\/\/.*$/, '')
      .replace(/\/\*.*?\*\//g, '')
      .trim();
    if (!line || line.startsWith('@')) {
      continue;
    }

    const openParenIndex = line.indexOf('(');
    if (openParenIndex < 0) {
      continue;
    }

    const beforeParen = line.slice(0, openParenIndex);
    const identifiers = beforeParen.match(/[A-Za-z_$][\w$]*/g) ?? [];
    const candidate = identifiers[identifiers.length - 1];
    if (candidate && !controlWords.has(candidate)) {
      return candidate;
    }
  }

  const fallback = selectedCode.trim().split('\n')[0]?.trim().replace(/\s+/g, ' ') ?? '';
  return fallback ? fallback.slice(0, 48) : 'Selected code';
}

function settleNodeScopeByFinalPosition(
  beforeDrag: CodeTrailDocument,
  afterDrag: CodeTrailDocument,
  nodeId: string
): CodeTrailDocument {
  const beforeNode = beforeDrag.nodes.find((node) => node.id === nodeId);
  const afterNode = afterDrag.nodes.find((node) => node.id === nodeId);
  if (!beforeNode || !afterNode) {
    return afterDrag;
  }

  const nodeRect = {
    x: afterNode.position.x,
    y: afterNode.position.y,
    width: afterNode.size.width,
    height: afterNode.size.height
  };
  const oldScopeId = beforeNode.scopeId;
  const oldScope = oldScopeId ? beforeDrag.scopes.find((scope) => scope.id === oldScopeId) : null;
  const intersectedScope = beforeDrag.scopes.find((scope) => intersects(scope.bounds, nodeRect));
  const nextScopeId = oldScope && intersects(oldScope.bounds, nodeRect)
    ? oldScope.id
    : intersectedScope?.id ?? null;

  const scopedDocument = {
    ...afterDrag,
    nodes: afterDrag.nodes.map((node) =>
      node.id === nodeId ? { ...node, scopeId: nextScopeId } : node
    )
  };

  const scopeIdsToRecompute = new Set<string>();
  if (oldScopeId) {
    scopeIdsToRecompute.add(oldScopeId);
  }
  if (nextScopeId) {
    scopeIdsToRecompute.add(nextScopeId);
  }

  return [...scopeIdsToRecompute].reduce(
    (current, scopeId) => recomputeScopeBounds(current, scopeId),
    scopedDocument
  );
}

function CodeTrailEditor() {
  const { setViewport } = useReactFlow();
  const [document, setDocumentState] = useState<CodeTrailDocument>(() => {
    const doc = createEmptyDocument('CodeTrail Study Map');
    const scope = createScope({
      title: 'Reading scope',
      bounds: { x: 60, y: 70, width: 820, height: 430 }
    });
    const nodeA = createCodeNode({
      title: 'A.entry',
      summary: 'Entry point being reviewed.',
      position: { x: 140, y: 160 },
      scopeId: scope.id,
      callAnchors: [{ id: 'anchor_example', label: 'B.work()', line: 2, startColumn: 2, endColumn: 10 }],
      codeSnapshot: 'function entry() {\n  B.work();\n}'
    });
    const nodeB = createCodeNode({
      title: 'B.work',
      summary: 'Called method.',
      position: { x: 560, y: 190 },
      scopeId: scope.id,
      codeSnapshot: 'function work() {\n  return true;\n}'
    });
    return {
      ...doc,
      scopes: [scope],
      nodes: [nodeA, nodeB],
      edges: [
        createEdge({
          sourceNodeId: nodeA.id,
          sourceAnchorId: 'anchor_example',
          targetNodeId: nodeB.id,
          label: 'calls'
        })
      ]
    };
  });
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [focusedId, setFocusedId] = useState<string | null>(null);
  const [projectPath, setProjectPath] = useState<string | null>(null);
  const [status, setStatus] = useState('Ready');
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const canvasRef = useRef<HTMLDivElement | null>(null);
  const scopeDragRef = useRef<ScopeDragState | null>(null);

  const setDocument = useCallback((next: CodeTrailDocument) => {
    setDocumentState({ ...next, metadata: { ...next.metadata, updatedAt: new Date().toISOString() } });
  }, []);

  const onToggleNode = useCallback(
    (nodeId: string) => {
      setDocument({
        ...document,
        nodes: document.nodes.map((node) =>
          node.id === nodeId ? { ...node, collapsed: !node.collapsed } : node
        )
      });
    },
    [document, setDocument]
  );

  const onResizeNode = useCallback(
    (id: string, width: number, height: number, x?: number, y?: number) => {
      const resizedNode = document.nodes.find((node) => node.id === id);
      if (resizedNode) {
        const nextNode = {
          ...resizedNode,
          position: {
            x: x ?? resizedNode.position.x,
            y: y ?? resizedNode.position.y
          },
          size: { width, height }
        };
        const nextScopes = document.scopes.map((scope) => {
          if (scope.id !== resizedNode.scopeId) {
            return scope;
          }
          const nodeRect = { ...nextNode.position, ...nextNode.size };
          return intersects(scope.bounds, nodeRect)
            ? { ...scope, bounds: includeRect(scope.bounds, nodeRect) }
            : scope;
        });
        setDocument({
          ...document,
          nodes: document.nodes.map((node) => (node.id === id ? nextNode : node)),
          scopes: nextScopes
        });
        return;
      }

      setDocument({
        ...document,
        scopes: document.scopes.map((scope) =>
          scope.id === id
            ? {
                ...scope,
                bounds: {
                  x: x ?? scope.bounds.x,
                  y: y ?? scope.bounds.y,
                  width,
                  height
                }
              }
            : scope
        )
      });
    },
    [document, setDocument]
  );

  const updateCodeNode = useCallback(
    (updatedNode: CodeTrailDocument['nodes'][number]) => {
      const nextDocument = {
        ...document,
        nodes: document.nodes.map((node) => (node.id === updatedNode.id ? updatedNode : node))
      };
      setDocument(pruneMissingSelectionAnchors(nextDocument, updatedNode.id));
    },
    [document, setDocument]
  );

  const createNodeFromSelection = useCallback(
    (sourceNode: CodeTrailDocument['nodes'][number], selection: SelectedCodeAnchor) => {
      const currentSourceNode = document.nodes.find((node) => node.id === sourceNode.id);
      if (!currentSourceNode || !selection.selectedText) {
        return;
      }

      const anchor = createAnchorFromSelection(selection);
      const node = createCodeNode({
        title: inferTitleFromSelectedCode(selection.selectedText),
        language: sourceNode.language,
        summary: 'Created from a selected code block.',
        codeSnapshot: selection.selectedText,
        position: {
          x: currentSourceNode.position.x + currentSourceNode.size.width + 80,
          y: currentSourceNode.position.y + 40
        },
        scopeId: currentSourceNode.scopeId
      });
      let nextDocument: CodeTrailDocument = {
        ...document,
        nodes: [
          ...document.nodes.map((item) =>
            item.id === currentSourceNode.id
              ? { ...item, callAnchors: [...item.callAnchors, anchor] }
              : item
          ),
          node
        ],
        edges: [
          ...document.edges,
          createEdge({
            sourceNodeId: currentSourceNode.id,
            sourceAnchorId: anchor.id,
            targetNodeId: node.id,
            label: anchor.label
          })
        ]
      };
      if (currentSourceNode.scopeId) {
        nextDocument = recomputeScopeBounds(nextDocument, currentSourceNode.scopeId);
      }
      setDocument(nextDocument);
      setSelectedId(node.id);
      setStatus('Created a linked node from the selected code.');
    },
    [document, setDocument]
  );

  const createSelectionAnchor = useCallback(
    (sourceNode: CodeTrailDocument['nodes'][number], selection: SelectedCodeAnchor) => {
      const currentSourceNode = document.nodes.find((node) => node.id === sourceNode.id);
      if (!currentSourceNode || !selection.selectedText) {
        return;
      }

      const anchor = createAnchorFromSelection(selection);
      setDocument({
        ...document,
        nodes: document.nodes.map((item) =>
          item.id === currentSourceNode.id
            ? { ...item, callAnchors: [...item.callAnchors, anchor] }
            : item
        )
      });
      setSelectedId(currentSourceNode.id);
      setStatus('Drag the new anchor endpoint to a target node.');
    },
    [document, setDocument]
  );

  const removeCallAnchor = useCallback(
    (sourceNodeId: string, anchorId: string) => {
      setDocument({
        ...document,
        nodes: document.nodes.map((node) =>
          node.id === sourceNodeId
            ? { ...node, callAnchors: node.callAnchors.filter((anchor) => anchor.id !== anchorId) }
            : node
        ),
        edges: document.edges.filter(
          (edge) => edge.sourceNodeId !== sourceNodeId || edge.sourceAnchorId !== anchorId
        )
      });
      setStatus('Connection anchor removed.');
    },
    [document, setDocument]
  );

  const connectSelectionToNode = useCallback(
    (sourceNode: CodeTrailDocument['nodes'][number], selection: SelectedCodeAnchor, targetNodeId: string) => {
      const currentSourceNode = document.nodes.find((node) => node.id === sourceNode.id);
      const targetNode = document.nodes.find((node) => node.id === targetNodeId);
      if (!currentSourceNode || !targetNode || targetNode.id === currentSourceNode.id || !selection.selectedText) {
        return;
      }

      const anchor = createAnchorFromSelection(selection);
      setDocument({
        ...document,
        nodes: document.nodes.map((item) =>
          item.id === currentSourceNode.id
            ? { ...item, callAnchors: [...item.callAnchors, anchor] }
            : item
        ),
        edges: [
          ...document.edges,
          createEdge({
            sourceNodeId: currentSourceNode.id,
            sourceAnchorId: anchor.id,
            targetNodeId,
            label: anchor.label
          })
        ]
      });
      setSelectedId(targetNodeId);
      setStatus(`Connected selected code to ${targetNode.title}.`);
    },
    [document, setDocument]
  );

  const deleteEdge = useCallback(
    (edgeId: string) => {
      const edge = document.edges.find((item) => item.id === edgeId);
      if (!edge) {
        return;
      }

      const nextEdges = document.edges.filter((item) => item.id !== edgeId);
      const hasOtherEdgeForAnchor = nextEdges.some(
        (item) => item.sourceNodeId === edge.sourceNodeId && item.sourceAnchorId === edge.sourceAnchorId
      );
      setDocument({
        ...document,
        nodes: document.nodes.map((node) =>
          node.id === edge.sourceNodeId && !hasOtherEdgeForAnchor
            ? { ...node, callAnchors: node.callAnchors.filter((anchor) => anchor.id !== edge.sourceAnchorId) }
            : node
        ),
        edges: nextEdges
      });
      setSelectedId(null);
      setStatus('Connection removed.');
    },
    [document, setDocument]
  );

  const updateEdgeLabel = useCallback(
    (edgeId: string, label: string) => {
      setDocument({
        ...document,
        edges: document.edges.map((edge) => (edge.id === edgeId ? { ...edge, label } : edge))
      });
      setStatus('Connection label updated.');
    },
    [document, setDocument]
  );

  const focusCodeNode = useCallback(
    (id: string, width?: number, height?: number) => {
      const node = document.nodes.find((item) => item.id === id);
      if (!node) {
        return;
      }

      const nodeWidth = width ?? node.size.width;
      const nodeHeight = height ?? node.size.height;
      setFocusedId(id);
      setSelectedId(id);

      if (hasUsableFlowViewport()) {
        const bounds = window.document.querySelector('.react-flow')?.getBoundingClientRect();
        const zoom = nodeHeight > (bounds?.height ?? 0) * 0.82 ? 1.05 : 1.35;
        const topMargin = 32;
        setViewport(
          {
            x: ((bounds?.width ?? 0) - nodeWidth * zoom) / 2 - node.position.x * zoom,
            y: topMargin - node.position.y * zoom,
            zoom
          },
          { duration: 420 }
        );
      }

      setStatus('Focused node. Mouse actions now target this node; click canvas or press Escape to restore canvas controls.');
    },
    [document.nodes, setViewport]
  );

  const mappedFlowNodes = useMemo(
    () =>
      toFlowNodes(
        document,
        onToggleNode,
        onResizeNode,
        updateCodeNode,
        createSelectionAnchor,
        removeCallAnchor,
        createNodeFromSelection,
        connectSelectionToNode,
        deleteEdge,
        setSelectedId,
        focusCodeNode,
        selectedId,
        focusedId
      ),
    [connectSelectionToNode, createNodeFromSelection, createSelectionAnchor, deleteEdge, document, focusCodeNode, focusedId, onResizeNode, onToggleNode, removeCallAnchor, selectedId, updateCodeNode]
  );
  const mappedFlowEdges = useMemo(
    () => toFlowEdges(document, deleteEdge, updateEdgeLabel),
    [deleteEdge, document, updateEdgeLabel]
  );
  const [flowNodes, setFlowNodes, onNodesChange] = useNodesState(mappedFlowNodes);
  const [flowEdges, setFlowEdges, onEdgesChange] = useEdgesState(mappedFlowEdges);

  useEffect(() => {
    setFlowNodes(mappedFlowNodes);
  }, [mappedFlowNodes, setFlowNodes]);

  useEffect(() => {
    setFlowEdges(mappedFlowEdges);
  }, [mappedFlowEdges, setFlowEdges]);

  useLayoutEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !focusedId) {
      return;
    }

    const stopCanvasWheel = (event: WheelEvent) => {
      scrollFocusedCodePanel(event.deltaX, event.deltaY);
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
    };

    canvas.addEventListener('wheel', stopCanvasWheel, { capture: true, passive: false });
    return () => canvas.removeEventListener('wheel', stopCanvasWheel, { capture: true });
  }, [focusedId]);

  const onConnect = useCallback<OnConnect>(
    (connection) => {
      if (focusedId) {
        return;
      }
      if (!connection.source || !connection.sourceHandle || !connection.target) {
        return;
      }
      const sourceNode = document.nodes.find((node) => node.id === connection.source);
      if (!sourceNode?.callAnchors.some((anchor) => anchor.id === connection.sourceHandle)) {
        setStatus('Edges must start from a call anchor.');
        return;
      }
      const edge = createEdge({
        sourceNodeId: connection.source,
        sourceAnchorId: connection.sourceHandle,
        targetNodeId: connection.target,
        label:
          sourceNode.callAnchors.find((anchor) => anchor.id === connection.sourceHandle)?.label ??
          'calls'
      });
      setDocument({ ...document, edges: [...document.edges, edge] });
    },
    [document, focusedId, setDocument]
  );

  const onSelectionChange = useCallback((params: OnSelectionChangeParams) => {
    setSelectedId(params.nodes[0]?.id ?? params.edges[0]?.id ?? null);
  }, []);

  const focusNode = useCallback(
    (node: Node) => {
      if (document.scopes.some((scope) => scope.id === node.id)) {
        return;
      }

      const width = numericDimension(node.style?.width, 360);
      const height = numericDimension(node.style?.height, 260);
      focusCodeNode(node.id, width, height);
    },
    [document.scopes, focusCodeNode]
  );

  const deleteSelected = useCallback(() => {
    if (!selectedId) {
      return;
    }

    if (document.nodes.some((node) => node.id === selectedId)) {
      const deletedNode = document.nodes.find((node) => node.id === selectedId);
      let nextDocument: CodeTrailDocument = {
        ...document,
        nodes: document.nodes.filter((node) => node.id !== selectedId),
        edges: document.edges.filter(
          (edge) => edge.sourceNodeId !== selectedId && edge.targetNodeId !== selectedId
        )
      };
      if (deletedNode?.scopeId) {
        nextDocument = recomputeScopeBounds(nextDocument, deletedNode.scopeId);
      }
      setDocument(nextDocument);
      setSelectedId(null);
      return;
    }

    if (document.scopes.some((scope) => scope.id === selectedId)) {
      setDocument({
        ...document,
        scopes: document.scopes.filter((scope) => scope.id !== selectedId),
        nodes: document.nodes.map((node) =>
          node.scopeId === selectedId ? { ...node, scopeId: null } : node
        )
      });
      setSelectedId(null);
      return;
    }

    if (document.edges.some((edge) => edge.id === selectedId)) {
      setDocument({
        ...document,
        edges: document.edges.filter((edge) => edge.id !== selectedId)
      });
      setSelectedId(null);
    }
  }, [document, selectedId, setDocument]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (
        target?.tagName === 'INPUT' ||
        target?.tagName === 'TEXTAREA' ||
        target?.tagName === 'SELECT' ||
        target?.isContentEditable
      ) {
        return;
      }
      if (event.key === 'Escape') {
        if (focusedId) {
          setFocusedId(null);
          setStatus('Canvas zoom restored.');
          return;
        }
        deleteSelected();
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [deleteSelected, focusedId]);

  const beginScopeDrag = useCallback(
    (node: Node) => {
      const draggedScope = document.scopes.find((scope) => scope.id === node.id);
      if (!draggedScope) {
        scopeDragRef.current = null;
        return;
      }

      const memberIds = new Set(
        document.nodes
          .filter((codeNode) => codeNode.scopeId === draggedScope.id)
          .map((codeNode) => codeNode.id)
      );

      scopeDragRef.current = {
        scopeId: draggedScope.id,
        startPosition: node.position,
        memberPositions: flowNodes
          .filter((flowNode) => memberIds.has(flowNode.id))
          .map((flowNode) => ({
            id: flowNode.id,
            position: flowNode.position
          }))
      };
    },
    [document.nodes, document.scopes, flowNodes]
  );

  const moveScopeMembersDuringDrag = useCallback(
    (node: Node) => {
      const scopeDrag = scopeDragRef.current;
      if (!scopeDrag || scopeDrag.scopeId !== node.id) {
        return;
      }

      const delta = {
        x: node.position.x - scopeDrag.startPosition.x,
        y: node.position.y - scopeDrag.startPosition.y
      };

      setFlowNodes((nodes) =>
        nodes.map((flowNode) => {
          const member = scopeDrag.memberPositions.find((item) => item.id === flowNode.id);
          return member
            ? {
                ...flowNode,
                position: {
                  x: member.position.x + delta.x,
                  y: member.position.y + delta.y
                }
              }
            : flowNode;
        })
      );
    },
    [setFlowNodes]
  );

  const finishScopeDrag = useCallback(
    (node: Node): CodeTrailDocument => {
      const scopeDrag = scopeDragRef.current;
      if (!scopeDrag || scopeDrag.scopeId !== node.id) {
        return updateGeometryFromFlowNodes(document, [node]);
      }

      const delta = {
        x: node.position.x - scopeDrag.startPosition.x,
        y: node.position.y - scopeDrag.startPosition.y
      };
      const memberNodes = scopeDrag.memberPositions
        .map((member) => {
          const flowNode = flowNodes.find((item) => item.id === member.id);
          return flowNode
            ? {
                ...flowNode,
                position: {
                  x: member.position.x + delta.x,
                  y: member.position.y + delta.y
                }
              }
            : null;
        })
        .filter((flowNode): flowNode is Node => flowNode !== null);

      return updateGeometryFromFlowNodes(document, [node, ...memberNodes]);
    },
    [document, flowNodes]
  );

  const addNode = () => {
    const node = createCodeNode({
      position: { x: 180 + document.nodes.length * 28, y: 160 + document.nodes.length * 22 }
    });
    setDocument({ ...document, nodes: [...document.nodes, node] });
    setSelectedId(node.id);
  };

  const addScope = () => {
    const scope = createScope({
      bounds: { x: 80 + document.scopes.length * 40, y: 80 + document.scopes.length * 32, width: 560, height: 360 }
    });
    setDocument({ ...document, scopes: [...document.scopes, scope] });
    setSelectedId(scope.id);
  };

  const newProject = () => {
    setDocument(createEmptyDocument('Untitled CodeTrail'));
    setProjectPath(null);
    setSelectedId(null);
    setStatus('New project created.');
  };

  const loadContent = (content: string, path: string | null) => {
    const parsed = parseDocument(content);
    const validation = validateDocument(parsed);
    if (!validation.valid) {
      throw new Error(validation.errors.join('\n'));
    }
    setDocument(parsed);
    setProjectPath(path);
    setSelectedId(null);
    setStatus(path ? `Opened ${path}` : 'Opened project.');
  };

  const openProject = async () => {
    try {
      const nativeResult = await openProjectNative();
      if (nativeResult) {
        loadContent(nativeResult.content, nativeResult.path);
        return;
      }
      fileInputRef.current?.click();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    }
  };

  const saveProject = async () => {
    try {
      const content = serializeDocument(document);
      if (projectPath) {
        await overwriteTextNative(projectPath, content);
        setStatus(`Saved ${projectPath}`);
        return;
      }
      const result = await saveTextNative('project.codetrail.json', content, 'application/json');
      setProjectPath(result.path);
      setStatus(result.usedBrowserDownload ? 'Project downloaded.' : result.path ? `Saved ${result.path}` : 'Save canceled.');
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    }
  };

  const saveProjectAs = async () => {
    try {
      const result = await saveTextNative('project.codetrail.json', serializeDocument(document), 'application/json');
      setProjectPath(result.path);
      setStatus(result.usedBrowserDownload ? 'Project downloaded.' : result.path ? `Saved ${result.path}` : 'Save canceled.');
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    }
  };

  const exportHtml = async () => {
    try {
      const html = generateStaticHtml(document);
      const result = await saveTextNative('codetrail-viewer.html', html, 'text/html');
      setStatus(result.usedBrowserDownload ? 'HTML exported as download.' : result.path ? `Exported ${result.path}` : 'Export canceled.');
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    }
  };

  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="brand">
          <SquareCode size={20} />
          <div>
            <strong>CodeTrail</strong>
            <span>{projectPath ?? 'Unsaved local project'}</span>
          </div>
        </div>
        <nav className="toolbar">
          <button onClick={newProject}><FilePlus2 size={16} /> New</button>
          <button onClick={openProject}><FolderOpen size={16} /> Open</button>
          <button onClick={saveProject}><Save size={16} /> Save</button>
          <button onClick={saveProjectAs}><Download size={16} /> Save As</button>
          <button onClick={exportHtml}><FileDown size={16} /> Export HTML</button>
          <button onClick={addNode}>Add Node</button>
          <button onClick={addScope}>Add Scope</button>
        </nav>
      </header>
      <section className="workspace">
        <div
          ref={canvasRef}
          className="canvas"
          onDoubleClickCapture={(event) => {
            if (!focusedId || isEventInsideFocusedNode(event.target)) {
              return;
            }

            event.preventDefault();
            event.stopPropagation();
          }}
          onClickCapture={(event) => {
            if (!focusedId || isEventInsideFocusedNode(event.target)) {
              return;
            }

            setFocusedId(null);
            setStatus('Canvas zoom restored.');
          }}
        >
          <ReactFlow
            nodes={flowNodes}
            edges={flowEdges}
            nodeTypes={nodeTypes}
            edgeTypes={edgeTypes}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onNodeDragStart={(_, node) => beginScopeDrag(node)}
            onNodeDrag={(_, node) => moveScopeMembersDuringDrag(node)}
            onNodeDragStop={(_, node) => {
              if (document.scopes.some((scope) => scope.id === node.id)) {
                setDocument(finishScopeDrag(node));
                scopeDragRef.current = null;
                return;
              }

              const changedNodes = [node];
              const nextDocument = updateGeometryFromFlowNodes(document, changedNodes);
              setDocument(settleNodeScopeByFinalPosition(document, nextDocument, node.id));
              scopeDragRef.current = null;
            }}
            onConnect={onConnect}
            onSelectionChange={onSelectionChange}
            onNodeClick={(_, node) => setSelectedId(node.id)}
            onNodeDoubleClick={(_, node) => focusNode(node)}
            onEdgeClick={(_, edge) => setSelectedId(edge.id)}
            onPaneClick={() => {
              if (focusedId) {
                setFocusedId(null);
                setStatus('Canvas zoom restored.');
              }
            }}
            edgesFocusable={!focusedId}
            nodesFocusable={!focusedId}
            elementsSelectable={!focusedId}
            fitView
            zoomOnScroll={!focusedId}
            panOnScroll={!focusedId}
            zoomOnPinch={!focusedId}
            zoomOnDoubleClick={!focusedId}
            panOnDrag={!focusedId}
            panActivationKeyCode={focusedId ? null : 'Space'}
            zoomActivationKeyCode={focusedId ? null : undefined}
            nodesDraggable={!focusedId}
            nodesConnectable={!focusedId}
            connectOnClick={!focusedId}
            autoPanOnConnect={!focusedId}
            autoPanOnNodeDrag={!focusedId}
            noWheelClassName="nowheel"
            noPanClassName="nopan"
            minZoom={0.25}
            maxZoom={2}
            proOptions={{ hideAttribution: true }}
          >
            <Background />
            <Controls />
            <MiniMap pannable zoomable />
          </ReactFlow>
        </div>
      </section>
      <footer className="statusbar">{status}</footer>
      <input
        ref={fileInputRef}
        type="file"
        accept=".codetrail.json,application/json"
        hidden
        onChange={async (event) => {
          const file = event.target.files?.[0];
          if (!file) return;
          try {
            loadContent(await file.text(), null);
          } catch (error) {
            setStatus(error instanceof Error ? error.message : String(error));
          } finally {
            event.target.value = '';
          }
        }}
      />
    </main>
  );
}

export function App() {
  return (
    <ReactFlowProvider>
      <CodeTrailEditor />
    </ReactFlowProvider>
  );
}
