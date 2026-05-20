import { codeTrailDocumentSchema } from './schema';
import type {
  CallAnchor,
  CodeNode,
  CodeTrailDocument,
  CodeTrailEdge,
  Scope,
  ValidationResult
} from './types';

export const DEFAULT_NODE_COLOR = '#e0f2fe';
export const DEFAULT_SCOPE_COLOR = '#dcfce7';
export const DEFAULT_EDGE_COLOR = '#2563eb';

export function newId(prefix: string): string {
  const suffix =
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID().slice(0, 8)
      : Math.random().toString(16).slice(2, 10);
  return `${prefix}_${suffix}`;
}

export function createEmptyDocument(title = 'Untitled CodeTrail'): CodeTrailDocument {
  const now = new Date().toISOString();
  return {
    version: 1,
    metadata: {
      title,
      description: '',
      createdAt: now,
      updatedAt: now
    },
    nodes: [],
    edges: [],
    scopes: [],
    viewport: { x: 0, y: 0, zoom: 1 }
  };
}

export function touchDocument(document: CodeTrailDocument): CodeTrailDocument {
  return {
    ...document,
    metadata: {
      ...document.metadata,
      updatedAt: new Date().toISOString()
    }
  };
}

export function createCodeNode(partial: Partial<CodeNode> = {}): CodeNode {
  return {
    id: partial.id ?? newId('node'),
    title: partial.title ?? 'New function',
    language: partial.language ?? 'typescript',
    summary: partial.summary ?? '',
    codeSnapshot: partial.codeSnapshot ?? 'function example() {\n  // paste code here\n}',
    position: partial.position ?? { x: 120, y: 120 },
    size: partial.size ?? { width: 360, height: 280 },
    collapsed: partial.collapsed ?? false,
    color: partial.color ?? DEFAULT_NODE_COLOR,
    scopeId: partial.scopeId ?? null,
    callAnchors: partial.callAnchors ?? []
  };
}

export function createCallAnchor(partial: Partial<CallAnchor> = {}): CallAnchor {
  return {
    id: partial.id ?? newId('anchor'),
    label: partial.label ?? 'call()',
    line: partial.line ?? 1,
    startColumn: partial.startColumn ?? 0,
    endColumn: partial.endColumn ?? 0
  };
}

export function createScope(partial: Partial<Scope> = {}): Scope {
  return {
    id: partial.id ?? newId('scope'),
    title: partial.title ?? 'Scope',
    color: partial.color ?? DEFAULT_SCOPE_COLOR,
    bounds: partial.bounds ?? { x: 80, y: 80, width: 520, height: 360 }
  };
}

export function createEdge(partial: Omit<Partial<CodeTrailEdge>, 'sourceNodeId' | 'sourceAnchorId' | 'targetNodeId'> & Pick<CodeTrailEdge, 'sourceNodeId' | 'sourceAnchorId' | 'targetNodeId'>): CodeTrailEdge {
  return {
    id: partial.id ?? newId('edge'),
    sourceNodeId: partial.sourceNodeId,
    sourceAnchorId: partial.sourceAnchorId,
    targetNodeId: partial.targetNodeId,
    label: partial.label ?? '',
    color: partial.color ?? DEFAULT_EDGE_COLOR
  };
}

export function parseDocument(raw: string): CodeTrailDocument {
  return codeTrailDocumentSchema.parse(JSON.parse(raw));
}

export function serializeDocument(document: CodeTrailDocument): string {
  return JSON.stringify(touchDocument(document), null, 2);
}

export function validateDocument(document: unknown): ValidationResult {
  const parsed = codeTrailDocumentSchema.safeParse(document);
  if (!parsed.success) {
    return {
      valid: false,
      errors: parsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`)
    };
  }

  const data = parsed.data;
  const nodeIds = new Set(data.nodes.map((node) => node.id));
  const scopeIds = new Set(data.scopes.map((scope) => scope.id));
  const errors: string[] = [];

  for (const node of data.nodes) {
    if (node.scopeId && !scopeIds.has(node.scopeId)) {
      errors.push(`Node "${node.title}" references missing scope "${node.scopeId}".`);
    }
  }

  for (const edge of data.edges) {
    const source = data.nodes.find((node) => node.id === edge.sourceNodeId);
    if (!source) {
      errors.push(`Edge "${edge.id}" references missing source node "${edge.sourceNodeId}".`);
      continue;
    }
    if (!nodeIds.has(edge.targetNodeId)) {
      errors.push(`Edge "${edge.id}" references missing target node "${edge.targetNodeId}".`);
    }
    if (!source.callAnchors.some((anchor) => anchor.id === edge.sourceAnchorId)) {
      errors.push(`Edge "${edge.id}" references missing call anchor "${edge.sourceAnchorId}".`);
    }
  }

  return {
    valid: errors.length === 0,
    errors
  };
}
