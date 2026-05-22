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
import { Download, FileDown, FilePlus2, FolderOpen, Link, RefreshCw, Save } from 'lucide-react';
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

type HostedProjectEntry = {
  title: string;
  path: string;
  description?: string;
  document?: CodeTrailDocument;
  source?: 'hosted' | 'local';
};

type HostedProjectManifest = {
  files: HostedProjectEntry[];
};

type GitHubSyncConfig = {
  owner: string;
  repo: string;
  branch: string;
  folder: string;
  token: string;
};

const HOSTED_PROJECT_MANIFEST = 'projects/manifest.json';
const LOCAL_PROJECT_LIBRARY_KEY = 'codetrail.projectLibrary';
const GITHUB_SYNC_CONFIG_KEY = 'codetrail.githubSyncConfig';
const GITHUB_UPLOAD_INTERVAL_MS = 4 * 60 * 60 * 1000;

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

function manifestUrl(): URL {
  return new URL(HOSTED_PROJECT_MANIFEST, window.location.href);
}

function projectUrlFromManifest(path: string): URL {
  return new URL(path, manifestUrl());
}

function embedProjectPathFromLocation(): string | null {
  const params = new URL(window.location.href).searchParams;
  return params.get('project');
}

function embedUrlForProject(path: string): string {
  const url = new URL(window.location.href);
  url.searchParams.set('embed', '1');
  url.searchParams.set('project', fileNameFromProjectPath(path));
  return url.toString();
}

function parseHostedProjectManifest(value: unknown): HostedProjectManifest {
  if (!value || typeof value !== 'object' || !Array.isArray((value as { files?: unknown }).files)) {
    throw new Error('Project library manifest must contain a files array.');
  }

  const files = (value as { files: unknown[] }).files.map((entry, index) => {
    if (!entry || typeof entry !== 'object') {
      throw new Error(`Project library entry ${index + 1} must be an object.`);
    }

    const item = entry as { title?: unknown; path?: unknown; description?: unknown };
    if (typeof item.title !== 'string' || !item.title.trim()) {
      throw new Error(`Project library entry ${index + 1} is missing a title.`);
    }
    if (typeof item.path !== 'string' || !item.path.trim()) {
      throw new Error(`Project library entry ${index + 1} is missing a path.`);
    }

    return {
      title: item.title,
      path: item.path,
      description: typeof item.description === 'string' ? item.description : undefined,
      source: 'hosted' as const
    };
  });

  return { files };
}

function loadLocalProjectLibrary(): HostedProjectEntry[] {
  try {
    const raw = window.localStorage.getItem(LOCAL_PROJECT_LIBRARY_KEY);
    if (!raw) {
      return [];
    }
    const parsed = JSON.parse(raw) as HostedProjectEntry[];
    return Array.isArray(parsed)
      ? parsed.filter((entry) => entry && typeof entry.title === 'string' && typeof entry.path === 'string')
      : [];
  } catch {
    return [];
  }
}

function storeLocalProjectLibrary(projects: HostedProjectEntry[]): void {
  const localProjects = projects.filter((entry) => entry.source === 'local' || entry.document);
  window.localStorage.setItem(LOCAL_PROJECT_LIBRARY_KEY, JSON.stringify(localProjects));
}

function pathForNewLocalProject(): string {
  const suffix =
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID().slice(0, 8)
      : Math.random().toString(16).slice(2, 10);
  return `local/project-${Date.now()}-${suffix}.codetrail.json`;
}

function defaultGitHubSyncConfig(): GitHubSyncConfig {
  return {
    owner: 'astrofei',
    repo: 'CodeTrail',
    branch: 'main',
    folder: 'public/projects',
    token: ''
  };
}

function loadGitHubSyncConfig(): GitHubSyncConfig {
  try {
    return {
      ...defaultGitHubSyncConfig(),
      ...JSON.parse(window.localStorage.getItem(GITHUB_SYNC_CONFIG_KEY) ?? '{}')
    };
  } catch {
    return defaultGitHubSyncConfig();
  }
}

function storeGitHubSyncConfig(config: GitHubSyncConfig): void {
  window.localStorage.setItem(GITHUB_SYNC_CONFIG_KEY, JSON.stringify(config));
}

function fileNameFromProjectPath(path: string): string {
  return path.split('/').filter(Boolean).pop() ?? `project-${Date.now()}.codetrail.json`;
}

function githubProjectPath(config: GitHubSyncConfig, projectPath: string): string {
  return `${config.folder.replace(/\/+$/, '')}/${fileNameFromProjectPath(projectPath)}`;
}

function encodeBase64Utf8(value: string): string {
  const bytes = new TextEncoder().encode(value);
  let binary = '';
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
}

async function githubContentSha(config: GitHubSyncConfig, path: string): Promise<string | undefined> {
  const url = `https://api.github.com/repos/${config.owner}/${config.repo}/contents/${encodeURI(path)}?ref=${encodeURIComponent(config.branch)}`;
  const response = await fetch(url, {
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${config.token}`,
      'X-GitHub-Api-Version': '2022-11-28'
    }
  });
  if (response.status === 404) {
    return undefined;
  }
  if (!response.ok) {
    throw new Error(`GitHub read failed for ${path} (${response.status}).`);
  }
  const payload = await response.json() as { sha?: string };
  return payload.sha;
}

async function uploadGitHubContent(
  config: GitHubSyncConfig,
  path: string,
  content: string,
  message: string
): Promise<void> {
  if (!config.token.trim()) {
    throw new Error('GitHub token is required before uploading.');
  }
  const sha = await githubContentSha(config, path);
  const response = await fetch(`https://api.github.com/repos/${config.owner}/${config.repo}/contents/${encodeURI(path)}`, {
    method: 'PUT',
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${config.token}`,
      'Content-Type': 'application/json',
      'X-GitHub-Api-Version': '2022-11-28'
    },
    body: JSON.stringify({
      branch: config.branch,
      message,
      content: encodeBase64Utf8(content),
      ...(sha ? { sha } : {})
    })
  });
  if (!response.ok) {
    throw new Error(`GitHub upload failed for ${path} (${response.status}).`);
  }
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
  const [hostedProjects, setHostedProjects] = useState<HostedProjectEntry[]>([]);
  const [hostedProjectStatus, setHostedProjectStatus] = useState('Loading project library...');
  const [activeHostedProjectPath, setActiveHostedProjectPath] = useState<string | null>(null);
  const [projectLibraryTitle, setProjectLibraryTitle] = useState('Project Library');
  const [contextMenu, setContextMenu] = useState<{ path: string; x: number; y: number } | null>(null);
  const [editingProjectPath, setEditingProjectPath] = useState<string | null>(null);
  const [githubConfig, setGithubConfig] = useState<GitHubSyncConfig>(() => loadGitHubSyncConfig());
  const [githubSyncStatus, setGithubSyncStatus] = useState('GitHub sync not configured.');
  const [isEditingGitHubToken, setIsEditingGitHubToken] = useState(() => !loadGitHubSyncConfig().token.trim());
  const [isEditingGitHubSettings, setIsEditingGitHubSettings] = useState(false);
  const [embedProjectPath] = useState(() => embedProjectPathFromLocation());
  const isEmbedMode = Boolean(embedProjectPath);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const canvasRef = useRef<HTMLDivElement | null>(null);
  const scopeDragRef = useRef<ScopeDragState | null>(null);
  const hasHydratedProjectLibraryRef = useRef(false);
  const lastAutoSavedDocumentRef = useRef<CodeTrailDocument | null>(null);
  const hasLoadedEmbedProjectRef = useRef(false);
  const lastEmbedUploadedDocumentRef = useRef<CodeTrailDocument | null>(null);

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

  const updateScope = useCallback(
    (updatedScope: CodeTrailDocument['scopes'][number]) => {
      setDocument({
        ...document,
        scopes: document.scopes.map((scope) => (scope.id === updatedScope.id ? updatedScope : scope))
      });
    },
    [document, setDocument]
  );

  const refreshHostedProjects = useCallback(async () => {
    try {
      const response = await fetch(manifestUrl(), { cache: 'no-store' });
      if (!response.ok) {
        throw new Error(`Project library unavailable (${response.status}).`);
      }
      const manifest = parseHostedProjectManifest(await response.json());
      const localProjects = loadLocalProjectLibrary();
      const localPaths = new Set(localProjects.map((entry) => entry.path));
      const projects = [
        ...localProjects,
        ...manifest.files.filter((entry) => !localPaths.has(entry.path))
      ];
      setHostedProjects(projects);
      setHostedProjectStatus(projects.length ? `${projects.length} project${projects.length === 1 ? '' : 's'}` : 'No projects yet.');
    } catch (error) {
      const localProjects = loadLocalProjectLibrary();
      setHostedProjects(localProjects);
      setHostedProjectStatus(error instanceof Error ? error.message : String(error));
    }
  }, []);

  useEffect(() => {
    void refreshHostedProjects();
  }, [refreshHostedProjects]);

  useEffect(() => {
    const closeContextMenu = () => setContextMenu(null);
    window.addEventListener('click', closeContextMenu);
    window.addEventListener('keydown', closeContextMenu);
    return () => {
      window.removeEventListener('click', closeContextMenu);
      window.removeEventListener('keydown', closeContextMenu);
    };
  }, []);

  useEffect(() => {
    if (!embedProjectPath || hasLoadedEmbedProjectRef.current || hostedProjects.length === 0) {
      return;
    }
    const targetProject = hostedProjects.find(
      (entry) => entry.path === embedProjectPath || fileNameFromProjectPath(entry.path) === embedProjectPath
    );
    if (!targetProject) {
      setStatus(`Project not found for ${embedProjectPath}.`);
      return;
    }

    hasLoadedEmbedProjectRef.current = true;
    void loadHostedProject(targetProject);
  }, [embedProjectPath, hostedProjects]);

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
        updateScope,
        selectedId,
        focusedId
      ),
    [connectSelectionToNode, createNodeFromSelection, createSelectionAnchor, deleteEdge, document, focusCodeNode, focusedId, onResizeNode, onToggleNode, removeCallAnchor, selectedId, updateCodeNode, updateScope]
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

  const loadContent = (content: string, path: string | null) => {
    const parsed = parseDocument(content);
    const validation = validateDocument(parsed);
    if (!validation.valid) {
      throw new Error(validation.errors.join('\n'));
    }
    setDocument(parsed);
    setProjectPath(path);
    setActiveHostedProjectPath(null);
    setSelectedId(null);
    setStatus(path ? `Opened ${path}` : 'Opened project.');
  };

  const persistProjectList = (projects: HostedProjectEntry[]) => {
    setHostedProjects(projects);
    setHostedProjectStatus(projects.length ? `${projects.length} project${projects.length === 1 ? '' : 's'}` : 'No projects yet.');
    storeLocalProjectLibrary(projects);
  };

  const updateGitHubConfig = (patch: Partial<GitHubSyncConfig>) => {
    const nextConfig = { ...githubConfig, ...patch };
    setGithubConfig(nextConfig);
    storeGitHubSyncConfig(nextConfig);
    setGithubSyncStatus(nextConfig.token.trim() ? 'GitHub sync configured.' : 'GitHub sync not configured.');
    if (patch.token !== undefined && patch.token.trim()) {
      setIsEditingGitHubToken(false);
    }
  };

  const uploadProjectToGitHub = async (
    entry: HostedProjectEntry,
    projectDocument: CodeTrailDocument,
    projects: HostedProjectEntry[] = hostedProjects
  ) => {
    const jsonPath = githubProjectPath(githubConfig, entry.path);
    const manifestPath = `${githubConfig.folder.replace(/\/+$/, '')}/manifest.json`;
    const manifest: HostedProjectManifest = {
      files: projects.map((project) => ({
        title: project.path === entry.path ? entry.title : project.title,
        path: fileNameFromProjectPath(project.path),
        description: project.path === entry.path ? entry.description : project.description
      }))
    };

    await uploadGitHubContent(
      githubConfig,
      jsonPath,
      serializeDocument(projectDocument),
      `Update CodeTrail project ${entry.title}`
    );
    await uploadGitHubContent(
      githubConfig,
      manifestPath,
      JSON.stringify(manifest, null, 2),
      'Update CodeTrail project manifest'
    );
    setGithubSyncStatus(`Uploaded ${entry.title} to GitHub.`);
  };

  const saveActiveProjectToGitHub = async () => {
    if (!activeHostedProjectPath) {
      throw new Error('No active project selected.');
    }
    const activeEntry = hostedProjects.find((entry) => entry.path === activeHostedProjectPath);
    if (!activeEntry) {
      throw new Error('Active project is missing from the project library.');
    }
    await uploadProjectToGitHub(activeEntry, document);
  };

  useEffect(() => {
    if (!activeHostedProjectPath) {
      return;
    }
    if (!hasHydratedProjectLibraryRef.current) {
      hasHydratedProjectLibraryRef.current = true;
      lastAutoSavedDocumentRef.current = document;
      return;
    }
    if (lastAutoSavedDocumentRef.current === document) {
      return;
    }

    const timeoutId = window.setTimeout(() => {
      const activeEntry = hostedProjects.find((entry) => entry.path === activeHostedProjectPath);
      const nextEntry: HostedProjectEntry = {
        ...activeEntry,
        title: activeEntry?.title ?? document.metadata.title,
        path: activeHostedProjectPath,
        description: activeEntry?.description ?? document.metadata.description,
        document,
        source: 'local'
      };
      const nextProjects = activeEntry
        ? hostedProjects.map((entry) => (entry.path === activeHostedProjectPath ? nextEntry : entry))
        : [nextEntry, ...hostedProjects];
      persistProjectList(nextProjects);
      lastAutoSavedDocumentRef.current = document;
      setStatus(`Auto-saved ${nextEntry.title}.`);
    }, 900);

    return () => window.clearTimeout(timeoutId);
  }, [activeHostedProjectPath, document, hostedProjects]);

  useEffect(() => {
    const intervalId = window.setInterval(() => {
      if (!activeHostedProjectPath || !githubConfig.token.trim()) {
        return;
      }
      const activeEntry = hostedProjects.find((entry) => entry.path === activeHostedProjectPath);
      if (!activeEntry) {
        return;
      }
      void uploadProjectToGitHub(activeEntry, document).catch((error) => {
        setGithubSyncStatus(error instanceof Error ? error.message : String(error));
      });
    }, GITHUB_UPLOAD_INTERVAL_MS);

    return () => window.clearInterval(intervalId);
  }, [activeHostedProjectPath, document, githubConfig, hostedProjects]);

  useEffect(() => {
    if (!isEmbedMode || !activeHostedProjectPath || !githubConfig.token.trim()) {
      return;
    }
    if (lastEmbedUploadedDocumentRef.current === document) {
      return;
    }

    const timeoutId = window.setTimeout(() => {
      const activeEntry = hostedProjects.find((entry) => entry.path === activeHostedProjectPath);
      if (!activeEntry) {
        return;
      }
      void uploadProjectToGitHub(activeEntry, document)
        .then(() => {
          lastEmbedUploadedDocumentRef.current = document;
          setStatus(`Auto-saved ${activeEntry.title} to GitHub.`);
        })
        .catch((error) => {
          setGithubSyncStatus(error instanceof Error ? error.message : String(error));
        });
    }, 5000);

    return () => window.clearTimeout(timeoutId);
  }, [activeHostedProjectPath, document, githubConfig, hostedProjects, isEmbedMode]);

  const updateProjectEntry = (path: string, patch: Partial<HostedProjectEntry>) => {
    persistProjectList(
      hostedProjects.map((entry) =>
        entry.path === path
          ? { ...entry, ...patch, source: 'local' }
          : entry
      )
    );
  };

  const saveCurrentToProjectList = (preferredPath = activeHostedProjectPath): string => {
    const path = preferredPath ?? pathForNewLocalProject();
    const entry = hostedProjects.find((item) => item.path === path);
    const nextEntry: HostedProjectEntry = {
      ...entry,
      title: document.metadata.title,
      path,
      description: document.metadata.description,
      document,
      source: 'local'
    };
    const nextProjects = entry
      ? hostedProjects.map((item) => (item.path === path ? nextEntry : item))
      : [nextEntry, ...hostedProjects];
    persistProjectList(nextProjects);
    return path;
  };

  const newProject = async () => {
    const currentPath = activeHostedProjectPath ?? pathForNewLocalProject();
    const currentEntry = hostedProjects.find((item) => item.path === currentPath);
    const savedCurrentEntry: HostedProjectEntry = {
      ...currentEntry,
      title: document.metadata.title,
      path: currentPath,
      description: document.metadata.description,
      document,
      source: 'local'
    };
    const nextDocument = createEmptyDocument('Untitled CodeTrail');
    const path = pathForNewLocalProject();
    const nextEntry: HostedProjectEntry = {
      title: nextDocument.metadata.title,
      path,
      description: nextDocument.metadata.description,
      document: nextDocument,
      source: 'local'
    };
    const remainingProjects = hostedProjects.filter((entry) => entry.path !== currentPath && entry.path !== path);
    const nextProjects = [nextEntry, savedCurrentEntry, ...remainingProjects];
    persistProjectList(nextProjects);
    if (githubConfig.token.trim()) {
      try {
        await uploadProjectToGitHub(savedCurrentEntry, document, nextProjects);
      } catch (error) {
        setGithubSyncStatus(error instanceof Error ? error.message : String(error));
      }
    }
    setDocument(nextDocument);
    setProjectPath(path);
    setActiveHostedProjectPath(path);
    setSelectedId(null);
    setStatus('Current project saved to the sidebar. New project created.');
  };

  const getProjectDocument = async (entry: HostedProjectEntry): Promise<CodeTrailDocument> => {
    if (entry.document) {
      return entry.document;
    }
    const response = await fetch(projectUrlFromManifest(entry.path), { cache: 'no-store' });
    if (!response.ok) {
      throw new Error(`Could not load ${entry.path} (${response.status}).`);
    }
    const parsed = parseDocument(await response.text());
    const validation = validateDocument(parsed);
    if (!validation.valid) {
      throw new Error(validation.errors.join('\n'));
    }
    return parsed;
  };

  const loadHostedProject = async (entry: HostedProjectEntry) => {
    try {
      const parsed = await getProjectDocument(entry);
      const validation = validateDocument(parsed);
      if (!validation.valid) {
        throw new Error(validation.errors.join('\n'));
      }
      setDocument(parsed);
      setProjectPath(entry.path);
      setActiveHostedProjectPath(entry.path);
      setSelectedId(null);
      setStatus(`Loaded hosted project ${entry.title}.`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    }
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

  const saveProjectEntry = (entry: HostedProjectEntry) => {
    saveCurrentToProjectList(entry.path);
    setActiveHostedProjectPath(entry.path);
    setProjectPath(entry.path);
    setStatus(`Saved current project to ${entry.title}.`);
  };

  const saveProjectEntryAs = async (entry: HostedProjectEntry) => {
    try {
      const projectDocument = entry.path === activeHostedProjectPath ? document : await getProjectDocument(entry);
      const result = await saveTextNative(entry.path.split('/').pop() ?? 'project.codetrail.json', serializeDocument(projectDocument), 'application/json');
      setStatus(result.usedBrowserDownload ? 'Project downloaded.' : result.path ? `Saved ${result.path}` : 'Save canceled.');
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    }
  };

  const exportProjectEntryHtml = async (entry: HostedProjectEntry) => {
    try {
      const projectDocument = entry.path === activeHostedProjectPath ? document : await getProjectDocument(entry);
      const fileName = `${entry.title.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-') || 'codetrail'}-viewer.html`;
      const result = await saveTextNative(fileName, generateStaticHtml(projectDocument), 'text/html');
      setStatus(result.usedBrowserDownload ? 'HTML exported as download.' : result.path ? `Exported ${result.path}` : 'Export canceled.');
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    }
  };

  const copyProjectEmbedLink = async (entry: HostedProjectEntry) => {
    try {
      await navigator.clipboard.writeText(embedUrlForProject(entry.path));
      setStatus(`Copied Notion link for ${entry.title}.`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    }
  };

  const saveEmbedProject = async () => {
    const savedPath = saveCurrentToProjectList(activeHostedProjectPath);
    setActiveHostedProjectPath(savedPath);
    if (githubConfig.token.trim()) {
      try {
        await saveActiveProjectToGitHub();
        setStatus('Saved to GitHub.');
      } catch (error) {
        setStatus(error instanceof Error ? error.message : String(error));
      }
      return;
    }
    setStatus('Saved locally. Add a GitHub token in the full editor to upload.');
  };

  const contextProject = contextMenu
    ? hostedProjects.find((entry) => entry.path === contextMenu.path) ?? null
    : null;

  return (
    <main className={isEmbedMode ? 'app-shell is-embed-mode' : 'app-shell'}>
      <section className={isEmbedMode ? 'workspace workspace--embed' : 'workspace'}>
        {!isEmbedMode ? (
        <aside className="project-sidebar" aria-label="Hosted project library">
          <div className="project-sidebar__header">
            <div className="project-sidebar__title">
              <input
                aria-label="Project library title"
                value={projectLibraryTitle}
                onChange={(event) => setProjectLibraryTitle(event.target.value)}
              />
              <span>{hostedProjectStatus}</span>
            </div>
            <div className="project-sidebar__actions">
              <button className="icon-button" onClick={() => void newProject()} title="New project" aria-label="New project">
                <FilePlus2 size={15} />
              </button>
              <button className="icon-button" onClick={openProject} title="Open project" aria-label="Open project">
                <FolderOpen size={15} />
              </button>
              <button className="icon-button" onClick={() => void refreshHostedProjects()} title="Refresh project library" aria-label="Refresh project library">
                <RefreshCw size={15} />
              </button>
            </div>
          </div>
          <section className="github-sync" aria-label="GitHub sync settings">
            <div className="github-sync__summary">
              <strong>GitHub Sync</strong>
              <button type="button" onClick={() => setIsEditingGitHubSettings((value) => !value)}>
                Settings
              </button>
            </div>
            {isEditingGitHubSettings ? (
              <div className="github-sync__grid">
                <label>
                  Owner
                  <input
                    value={githubConfig.owner}
                    onChange={(event) => updateGitHubConfig({ owner: event.target.value })}
                  />
                </label>
                <label>
                  Repo
                  <input
                    value={githubConfig.repo}
                    onChange={(event) => updateGitHubConfig({ repo: event.target.value })}
                  />
                </label>
                <label>
                  Branch
                  <input
                    value={githubConfig.branch}
                    onChange={(event) => updateGitHubConfig({ branch: event.target.value })}
                  />
                </label>
                <label>
                  Folder
                  <input
                    value={githubConfig.folder}
                    onChange={(event) => updateGitHubConfig({ folder: event.target.value })}
                  />
                </label>
              </div>
            ) : null}
            <div className="github-sync__token">
              <span>GitHub token</span>
              {githubConfig.token.trim() && !isEditingGitHubToken ? (
                <div className="github-sync__token-row">
                  <strong>Token saved</strong>
                  <button type="button" onClick={() => setIsEditingGitHubToken(true)}>Change</button>
                  <button type="button" onClick={() => updateGitHubConfig({ token: '' })}>Clear</button>
                </div>
              ) : (
                <input
                  aria-label="GitHub token"
                  type="password"
                  placeholder="Fine-grained token with Contents read/write"
                  value={githubConfig.token}
                  onChange={(event) => updateGitHubConfig({ token: event.target.value })}
                />
              )}
            </div>
            <span>{githubSyncStatus}</span>
          </section>
          <div className="project-list">
            {hostedProjects.map((entry) => (
              <article
                key={entry.path}
                className={entry.path === activeHostedProjectPath ? 'project-list__item is-active' : 'project-list__item'}
                onClick={() => void loadHostedProject(entry)}
                onDoubleClick={(event) => {
                  event.stopPropagation();
                  setEditingProjectPath(entry.path);
                }}
                onContextMenu={(event) => {
                  event.preventDefault();
                  setContextMenu({ path: entry.path, x: event.clientX, y: event.clientY });
                }}
              >
                {editingProjectPath === entry.path ? (
                  <>
                    <input
                      aria-label={`${entry.title} title`}
                      value={entry.title}
                      autoFocus
                      onClick={(event) => event.stopPropagation()}
                      onKeyDown={(event) => {
                        if (event.key === 'Escape' || event.key === 'Enter') {
                          setEditingProjectPath(null);
                        }
                      }}
                      onChange={(event) => updateProjectEntry(entry.path, { title: event.target.value || 'Untitled project' })}
                    />
                    <textarea
                      aria-label={`${entry.title} description`}
                      value={entry.description ?? ''}
                      onClick={(event) => event.stopPropagation()}
                      onChange={(event) => updateProjectEntry(entry.path, { description: event.target.value })}
                      rows={2}
                    />
                  </>
                ) : (
                  <>
                    <strong>{entry.title}</strong>
                    {entry.description ? <span>{entry.description}</span> : <span className="project-list__description-empty">Double-click to add a description.</span>}
                  </>
                )}
                <small>{entry.path}</small>
              </article>
            ))}
            {hostedProjects.length === 0 ? (
              <p className="project-list__empty">Add files under public/projects and list them in manifest.json.</p>
            ) : null}
          </div>
          {contextProject ? (
            <div
              className="project-context-menu"
              style={{ left: contextMenu?.x ?? 0, top: contextMenu?.y ?? 0 }}
              onClick={(event) => event.stopPropagation()}
            >
              <button onClick={() => { saveProjectEntry(contextProject); setContextMenu(null); }}>
                <Save size={14} /> Save
              </button>
              <button onClick={() => { void saveProjectEntryAs(contextProject); setContextMenu(null); }}>
                <Download size={14} /> Save As
              </button>
              <button onClick={() => { void exportProjectEntryHtml(contextProject); setContextMenu(null); }}>
                <FileDown size={14} /> Export HTML
              </button>
              <button onClick={() => { void copyProjectEmbedLink(contextProject); setContextMenu(null); }}>
                <Link size={14} /> Copy Notion Link
              </button>
            </div>
          ) : null}
        </aside>
        ) : null}
        <div
          ref={canvasRef}
          className={isEmbedMode ? 'canvas canvas--embed' : 'canvas'}
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
            <Controls showInteractive={false} />
            <MiniMap pannable zoomable />
          </ReactFlow>
          {isEmbedMode ? (
            <div className="embed-savebar">
              <strong>{hostedProjects.find((entry) => entry.path === activeHostedProjectPath)?.title ?? document.metadata.title}</strong>
              <span>{githubConfig.token.trim() ? 'Auto-saves to GitHub after edits.' : 'Saved locally until GitHub token is configured.'}</span>
              <button onClick={() => void saveEmbedProject()}>
                <Save size={14} /> Save
              </button>
            </div>
          ) : null}
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
