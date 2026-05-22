export type Point = {
  x: number;
  y: number;
};

export type Size = {
  width: number;
  height: number;
};

export type Rect = Point & Size;

export type CallAnchor = {
  id: string;
  label: string;
  line: number;
  startColumn: number;
  endColumn: number;
  selectedText?: string;
};

export type CodeNode = {
  id: string;
  title: string;
  language: string;
  summary: string;
  codeSnapshot: string;
  position: Point;
  size: Size;
  collapsed: boolean;
  color: string;
  scopeId: string | null;
  callAnchors: CallAnchor[];
};

export type CodeTrailEdge = {
  id: string;
  sourceNodeId: string;
  sourceAnchorId: string;
  targetNodeId: string;
  label: string;
  color: string;
};

export type Scope = {
  id: string;
  title: string;
  description?: string;
  color: string;
  bounds: Rect;
};

export type CodeTrailDocument = {
  version: 1;
  metadata: {
    title: string;
    description: string;
    createdAt: string;
    updatedAt: string;
  };
  nodes: CodeNode[];
  edges: CodeTrailEdge[];
  scopes: Scope[];
  viewport: {
    x: number;
    y: number;
    zoom: number;
  };
};

export type ValidationResult = {
  valid: boolean;
  errors: string[];
};
