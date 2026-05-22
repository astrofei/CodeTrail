import { memo, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { CSSProperties, MouseEvent, ReactNode } from 'react';
import { Handle, NodeProps, NodeResizer, Position } from '@xyflow/react';
import { ChevronDown, ChevronRight, GitBranchPlus, Plus, X } from 'lucide-react';
import type { CodeNodeData, SelectedCodeAnchor } from './flowMapping';

const LANGUAGE_OPTIONS = ['typescript', 'javascript', 'c++', 'c', 'kotlin', 'java', 'rust', 'python', 'go', 'swift'];
const MIN_NODE_WIDTH = 260;
const MIN_NODE_HEIGHT = 120;
const MAX_AUTO_WIDTH = 960;
const AUTO_WIDTH_TOLERANCE = 72;
const AUTO_HEIGHT_TOLERANCE = 8;
const HEADER_HEIGHT = 55;
const SUMMARY_MIN_HEIGHT = 58;
const CODE_VERTICAL_CHROME = 62;
const CODE_LINE_HEIGHT = 21;
const NODE_HEIGHT_BUFFER = 8;
const MIN_CODE_PANEL_HEIGHT = 58;
const KEYWORDS_BY_LANGUAGE: Record<string, string[]> = {
  typescript: ['async', 'await', 'break', 'case', 'catch', 'class', 'const', 'continue', 'else', 'export', 'extends', 'for', 'from', 'function', 'if', 'import', 'interface', 'let', 'new', 'return', 'throw', 'try', 'type', 'while'],
  javascript: ['async', 'await', 'break', 'case', 'catch', 'class', 'const', 'continue', 'else', 'export', 'extends', 'for', 'from', 'function', 'if', 'import', 'let', 'new', 'return', 'throw', 'try', 'while'],
  java: ['abstract', 'boolean', 'break', 'byte', 'case', 'catch', 'char', 'class', 'continue', 'default', 'do', 'double', 'else', 'enum', 'extends', 'final', 'finally', 'float', 'for', 'if', 'implements', 'import', 'instanceof', 'int', 'interface', 'long', 'native', 'new', 'null', 'override', 'package', 'private', 'protected', 'public', 'return', 'short', 'static', 'strictfp', 'super', 'switch', 'synchronized', 'this', 'throw', 'throws', 'transient', 'try', 'void', 'volatile', 'while'],
  kotlin: ['class', 'data', 'else', 'false', 'fun', 'if', 'import', 'interface', 'is', 'null', 'object', 'override', 'private', 'return', 'true', 'val', 'var', 'when', 'while'],
  python: ['as', 'async', 'await', 'class', 'def', 'elif', 'else', 'except', 'False', 'for', 'from', 'if', 'import', 'in', 'None', 'return', 'self', 'True', 'try', 'while', 'with'],
  rust: ['async', 'await', 'crate', 'else', 'enum', 'fn', 'for', 'if', 'impl', 'let', 'match', 'mod', 'mut', 'pub', 'return', 'self', 'struct', 'trait', 'use', 'while'],
  go: ['break', 'case', 'const', 'defer', 'else', 'for', 'func', 'go', 'if', 'import', 'interface', 'map', 'package', 'range', 'return', 'select', 'struct', 'type', 'var'],
  swift: ['class', 'else', 'enum', 'extension', 'false', 'for', 'func', 'guard', 'if', 'import', 'let', 'nil', 'private', 'public', 'return', 'self', 'struct', 'true', 'var', 'while'],
  c: ['break', 'case', 'char', 'const', 'continue', 'else', 'enum', 'for', 'if', 'int', 'long', 'return', 'sizeof', 'static', 'struct', 'switch', 'void', 'while'],
  'c++': ['auto', 'break', 'case', 'class', 'const', 'continue', 'else', 'enum', 'for', 'if', 'namespace', 'new', 'private', 'public', 'return', 'static', 'struct', 'template', 'void', 'while']
};

function anchorByLine(data: CodeNodeData, line: number) {
  return data.codeNode.callAnchors.filter((anchor) => anchor.line === line);
}

function normalizeLanguage(language: string): string {
  const normalized = language.toLowerCase();
  return normalized === 'cpp' ? 'c++' : normalized;
}

function renderHighlightedLine(line: string, language: string): ReactNode[] {
  const normalizedLanguage = normalizeLanguage(language);
  const keywords = new Set(KEYWORDS_BY_LANGUAGE[normalizedLanguage] ?? []);
  const pattern = /(\/\/.*|#.*|\/\*.*?\*\/|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`(?:\\.|[^`\\])*`|@[A-Za-z_][A-Za-z0-9_]*|\b\d+(?:\.\d+)?\b|\b[A-Za-z_][A-Za-z0-9_]*\b)/g;
  const parts: ReactNode[] = [];
  let cursor = 0;
  let index = 0;

  for (const match of line.matchAll(pattern)) {
    const value = match[0];
    const start = match.index ?? 0;
    if (start > cursor) {
      parts.push(line.slice(cursor, start));
    }

    let className = '';
    if (value.startsWith('//') || (value.startsWith('#') && normalizedLanguage !== 'c++') || value.startsWith('/*')) {
      className = 'syntax-comment';
    } else if (value.startsWith('"') || value.startsWith("'") || value.startsWith('`')) {
      className = 'syntax-string';
    } else if (value.startsWith('@')) {
      className = 'syntax-annotation';
    } else if (/^\d/.test(value)) {
      className = 'syntax-number';
    } else if (keywords.has(value)) {
      className = 'syntax-keyword';
    } else {
      const tail = line.slice(start + value.length);
      if (/^\s*\(/.test(tail)) {
        className = 'syntax-function';
      } else if (/^[A-Z]/.test(value)) {
        className = 'syntax-type';
      }
    }

    parts.push(className ? <span key={`${start}-${index++}`} className={className}>{value}</span> : value);
    cursor = start + value.length;
  }

  if (cursor < line.length) {
    parts.push(line.slice(cursor));
  }

  return parts.length > 0 ? parts : [' '];
}

function estimateWrappedLineCount(value: string, availableCharacters: number): number {
  const lines = value.split('\n');
  return lines.reduce((total, line) => {
    const visualLength = Math.max(1, line.length);
    return total + Math.max(1, Math.ceil(visualLength / availableCharacters));
  }, 0);
}

function sizeForContent(
  nodeWidth: number,
  summary: string,
  codeSnapshot: string
): { width: number; height: number } {
  const longestCodeLine = Math.max(0, ...codeSnapshot.split('\n').map((line) => line.length));
  const contentWidth = Math.min(MAX_AUTO_WIDTH, 142 + longestCodeLine * 7);
  const width = Math.min(MAX_AUTO_WIDTH, Math.max(MIN_NODE_WIDTH, Math.min(nodeWidth, contentWidth + AUTO_WIDTH_TOLERANCE), contentWidth));
  const summaryCharactersPerLine = Math.max(22, Math.floor((width - 32) / 7));
  const summaryHeight = Math.max(
    SUMMARY_MIN_HEIGHT,
    estimateWrappedLineCount(summary || ' ', summaryCharactersPerLine) * 20 + 24
  );
  const codeHeight =
    Math.max(3, codeSnapshot.split('\n').length) * CODE_LINE_HEIGHT + CODE_VERTICAL_CHROME;

  return {
    width,
    height: Math.max(MIN_NODE_HEIGHT, Math.ceil(HEADER_HEIGHT + summaryHeight + codeHeight + NODE_HEIGHT_BUFFER))
  };
}

function summaryHeightForWidth(width: number, summary: string): number {
  const summaryCharactersPerLine = Math.max(22, Math.floor((width - 32) / 7));
  return Math.max(
    SUMMARY_MIN_HEIGHT,
    estimateWrappedLineCount(summary || ' ', summaryCharactersPerLine) * 20 + 24
  );
}

function minimumExpandedHeight(width: number, summary: string): number {
  return Math.max(
    MIN_NODE_HEIGHT,
    Math.ceil(HEADER_HEIGHT + summaryHeightForWidth(width, summary) + MIN_CODE_PANEL_HEIGHT)
  );
}

function fitTextareaToContent(element: HTMLTextAreaElement | null) {
  if (!element) {
    return;
  }

  element.style.height = 'auto';
  element.style.height = `${element.scrollHeight}px`;
}

function labelForSelection(selectedText: string): string {
  const compact = selectedText.split('\n')[0].trim().replace(/\s+/g, ' ');
  return compact.length > 34 ? `${compact.slice(0, 31)}...` : compact || 'selected code';
}

function selectionAnchorFromText(codeSnapshot: string, rawSelection: string): SelectedCodeAnchor | null {
  const selectedText = rawSelection.trim();
  if (!selectedText) {
    return null;
  }

  const startIndex = codeSnapshot.indexOf(selectedText);
  if (startIndex < 0) {
    return null;
  }

  const beforeSelection = codeSnapshot.slice(0, startIndex);
  const line = beforeSelection.split('\n').length;
  const lineStartIndex = beforeSelection.lastIndexOf('\n') + 1;
  const nextLineBreak = codeSnapshot.indexOf('\n', startIndex);
  const lineEndIndex = nextLineBreak >= 0 ? nextLineBreak : codeSnapshot.length;
  const endIndex = startIndex + selectedText.length;

  return {
    label: labelForSelection(selectedText),
    line,
    startColumn: startIndex - lineStartIndex,
    endColumn: Math.min(endIndex, lineEndIndex) - lineStartIndex,
    selectedText
  };
}

function selectionAnchorFromLine(codeSnapshot: string, lineIndex: number): SelectedCodeAnchor | null {
  const lineText = codeSnapshot.split('\n')[lineIndex];
  if (lineText === undefined) {
    return null;
  }

  const selectedText = lineText.trim();
  if (!selectedText) {
    return null;
  }

  const startColumn = lineText.indexOf(selectedText);
  return {
    label: labelForSelection(selectedText),
    line: lineIndex + 1,
    startColumn,
    endColumn: startColumn + selectedText.length,
    selectedText
  };
}

export const CodeNodeView = memo(function CodeNodeView({ data, selected }: NodeProps) {
  const nodeData = data as CodeNodeData;
  const {
    codeNode,
    connectionCount,
    connectedSourceAnchorIds,
    focused,
    onCreateSelectionAnchor,
    onCreateNodeFromSelection,
    onFocus,
    onRemoveCallAnchor,
    onResize,
    onSelect,
    onToggle,
    onUpdate,
    scopeTitle
  } = nodeData;
  const isSelected = selected || nodeData.selected;
  const lines = codeNode.codeSnapshot.split('\n');
  const [editing, setEditing] = useState<'title' | 'code' | null>(null);
  const [selectedAnchor, setSelectedAnchor] = useState<SelectedCodeAnchor | null>(null);
  const [selectionMenu, setSelectionMenu] = useState<{ x: number; y: number; anchor: SelectedCodeAnchor } | null>(null);
  const minExpandedHeight = minimumExpandedHeight(codeNode.size.width, codeNode.summary);
  const nodeRef = useRef<HTMLElement | null>(null);
  const summaryRef = useRef<HTMLTextAreaElement | null>(null);
  const codeRef = useRef<HTMLPreElement | null>(null);
  const codeWrapRef = useRef<HTMLDivElement | null>(null);
  const codeEditorRef = useRef<HTMLTextAreaElement | null>(null);
  const connectedAnchorIds = new Set(connectedSourceAnchorIds);

  const commitText = (field: 'title' | 'summary' | 'codeSnapshot', value: string) => {
    const nextNode = { ...codeNode, [field]: value };
    const nextSize =
      field === 'summary' || field === 'codeSnapshot'
        ? sizeForContent(codeNode.size.width, nextNode.summary, nextNode.codeSnapshot)
        : nextNode.size;
    onUpdate({ ...nextNode, size: nextSize });
    setEditing(null);
  };

  const captureSelectedCode = () => {
    const text = window.getSelection()?.toString() ?? '';
    const anchor = selectionAnchorFromText(codeNode.codeSnapshot, text);
    setSelectedAnchor(anchor);
    if (!anchor) {
      setSelectionMenu(null);
    }
  };

  const openSelectionMenu = (event: MouseEvent) => {
    captureSelectedCode();
    const text = window.getSelection()?.toString() ?? '';
    const clickedLine = (event.target as HTMLElement).closest<HTMLElement>('.code-line');
    const lineIndex = clickedLine ? Number(clickedLine.dataset.lineIndex) : Number.NaN;
    const anchor =
      selectionAnchorFromText(codeNode.codeSnapshot, text) ??
      (Number.isFinite(lineIndex) ? selectionAnchorFromLine(codeNode.codeSnapshot, lineIndex) : null);
    if (!anchor || !codeWrapRef.current) {
      return;
    }

    const bounds = codeWrapRef.current.getBoundingClientRect();
    event.preventDefault();
    event.stopPropagation();
    setSelectedAnchor(anchor);
    setSelectionMenu({
      x: event.clientX - bounds.left,
      y: event.clientY - bounds.top,
      anchor
    });
  };

  const clearSelectionMenu = () => {
    setSelectionMenu(null);
    setSelectedAnchor(null);
    window.getSelection()?.removeAllRanges();
  };

  useLayoutEffect(() => {
    const element = nodeRef.current;
    if (!element || codeNode.collapsed) {
      return;
    }

    const measuredHeight =
      element.scrollHeight > element.clientHeight + 2
        ? Math.ceil(element.scrollHeight + NODE_HEIGHT_BUFFER)
        : 0;
    const estimatedSize = sizeForContent(codeNode.size.width, codeNode.summary, codeNode.codeSnapshot);
    const preferredHeight = Math.max(estimatedSize.height, measuredHeight);
    const nextSize = {
      width:
        codeNode.size.width > estimatedSize.width + AUTO_WIDTH_TOLERANCE
          ? estimatedSize.width
          : Math.min(MAX_AUTO_WIDTH, Math.max(codeNode.size.width, estimatedSize.width)),
      height:
        codeNode.size.height > preferredHeight + AUTO_HEIGHT_TOLERANCE
          ? preferredHeight
          : Math.max(codeNode.size.height, preferredHeight)
    };

    if (
      Math.abs(nextSize.width - codeNode.size.width) > 2 ||
      Math.abs(nextSize.height - codeNode.size.height) > 2
    ) {
      onResize(codeNode.id, nextSize.width, nextSize.height, codeNode.position.x, codeNode.position.y);
    }
  }, [
    codeNode.collapsed,
    codeNode.codeSnapshot,
    codeNode.id,
    codeNode.position.x,
    codeNode.position.y,
    codeNode.size.height,
    codeNode.size.width,
    codeNode.summary,
    onResize
  ]);

  useLayoutEffect(() => {
    fitTextareaToContent(summaryRef.current);
    fitTextareaToContent(codeEditorRef.current);
  }, [codeNode.codeSnapshot, codeNode.summary, editing]);

  useEffect(() => {
    if (!selectionMenu) {
      return;
    }

    const closeMenu = () => setSelectionMenu(null);
    window.addEventListener('click', closeMenu);
    return () => window.removeEventListener('click', closeMenu);
  }, [selectionMenu]);

  return (
    <section
      ref={nodeRef}
      className={`code-node ${isSelected ? 'is-selected' : ''} ${focused ? 'is-focused nowheel nopan' : ''}`}
      style={{ '--node-color': codeNode.color } as CSSProperties}
      onClick={(event) => {
        event.stopPropagation();
        onSelect(codeNode.id);
      }}
      onDoubleClickCapture={(event) => {
        const target = event.target as HTMLElement;
        if (target.closest('button, input, select, textarea')) {
          return;
        }
        onFocus(codeNode.id);
      }}
      onDoubleClick={(event) => {
        const target = event.target as HTMLElement;
        if (target.closest('button, input, select, textarea')) {
          return;
        }
        event.stopPropagation();
        onFocus(codeNode.id);
      }}
      onWheelCapture={(event) => {
        if (focused) {
          event.stopPropagation();
        }
      }}
    >
      <NodeResizer
        isVisible={isSelected && !codeNode.collapsed}
        minWidth={MIN_NODE_WIDTH}
        minHeight={minExpandedHeight}
        onResizeEnd={(_, params) => {
          onResize(codeNode.id, params.width, params.height, params.x, params.y);
        }}
      />
      <Handle id="target" type="target" position={Position.Left} className="target-handle" />
      <header className="code-node__header">
        <button
          className="code-node__toggle nodrag"
          title={codeNode.collapsed ? 'Expand node' : 'Collapse node'}
          onClick={(event) => {
            event.stopPropagation();
            onToggle(codeNode.id);
          }}
        >
          {codeNode.collapsed ? <ChevronRight size={16} /> : <ChevronDown size={16} />}
        </button>
        <div className="code-node__title-wrap">
          {editing === 'title' ? (
            <input
              className="inline-title-input nodrag"
              autoFocus
              defaultValue={codeNode.title}
              onBlur={(event) => commitText('title', event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  commitText('title', event.currentTarget.value);
                }
                if (event.key === 'Escape') {
                  setEditing(null);
                }
              }}
            />
          ) : (
            <strong onDoubleClick={() => setEditing('title')}>{codeNode.title}</strong>
          )}
          <span>{scopeTitle ?? codeNode.language}</span>
        </div>
        <span className="code-node__count" title="External connections">{connectionCount}</span>
      </header>
      <textarea
        ref={summaryRef}
        className="code-node__summary code-node__summary-editor nodrag"
        aria-label="Node summary"
        defaultValue={codeNode.summary}
        placeholder="Add a summary..."
        rows={2}
        onInput={(event) => fitTextareaToContent(event.currentTarget)}
        onBlur={(event) => {
          if (event.target.value !== codeNode.summary) {
            commitText('summary', event.target.value);
          }
        }}
      />
      {codeNode.collapsed && codeNode.callAnchors.length > 0 && (
        <div className="collapsed-anchor-handles" aria-hidden="true">
          {codeNode.callAnchors.map((anchor) => (
            <span key={anchor.id} className="collapsed-anchor-handle-slot">
              <Handle
                id={anchor.id}
                type="source"
                position={Position.Right}
                className="collapsed-anchor__handle"
              />
            </span>
          ))}
        </div>
      )}
      {!codeNode.collapsed && (
        <div className="code-node__code-panel">
          <select
            className="code-node__language nodrag"
            title="Language"
            value={codeNode.language}
            onChange={(event) => onUpdate({ ...codeNode, language: event.target.value })}
          >
            {LANGUAGE_OPTIONS.map((language) => (
              <option key={language} value={language}>
                {language}
              </option>
            ))}
          </select>
          {editing === 'code' ? (
            <textarea
              ref={codeEditorRef}
              className="code-node__code code-node__textarea nodrag"
              autoFocus
              spellCheck={false}
              defaultValue={codeNode.codeSnapshot}
              onInput={(event) => fitTextareaToContent(event.currentTarget)}
              onBlur={(event) => commitText('codeSnapshot', event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Escape') {
                  setEditing(null);
                }
              }}
            />
          ) : (
            <div ref={codeWrapRef} className="code-node__code-wrap">
              {selectedAnchor && !selectionMenu && <span className="selection-hint">Right-click selection</span>}
              {selectionMenu && (
                <div
                  className="selection-menu nodrag"
                  style={{ left: selectionMenu.x, top: selectionMenu.y }}
                  onClick={(event) => event.stopPropagation()}
                  onMouseDown={(event) => event.preventDefault()}
                >
                  <button
                    type="button"
                    onClick={() => {
                      onCreateNodeFromSelection(codeNode, selectionMenu.anchor);
                      clearSelectionMenu();
                    }}
                  >
                    <Plus size={15} />
                    New node
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      onCreateSelectionAnchor(codeNode, selectionMenu.anchor);
                      clearSelectionMenu();
                    }}
                  >
                    <GitBranchPlus size={15} />
                    Draw connection
                  </button>
                </div>
              )}
              <pre
                ref={codeRef}
                className="code-node__code nodrag nopan"
                onMouseUp={captureSelectedCode}
                onContextMenu={openSelectionMenu}
                onDoubleClick={() => setEditing('code')}
              >
                {lines.map((line, index) => {
                  const lineNo = index + 1;
                  const anchors = anchorByLine(data as CodeNodeData, lineNo);
                  return (
                    <span
                      key={lineNo}
                      className={`code-line ${anchors.length ? 'has-anchor' : ''}`}
                      data-line-index={index}
                    >
                      <span className="code-line__number">{lineNo}</span>
                      <span className="code-line__text">{renderHighlightedLine(line, codeNode.language)}</span>
                      {anchors.map((anchor) => {
                        const isConnected = connectedAnchorIds.has(anchor.id);
                        return (
                        <span key={anchor.id} className={`call-anchor-endpoint ${isConnected ? 'is-connected' : 'is-dangling'}`}>
                          <Handle
                            id={anchor.id}
                            type="source"
                            position={Position.Right}
                            className="call-anchor__handle"
                          />
                          {!isConnected && (
                            <button
                              type="button"
                              className="anchor-cancel-button nodrag"
                              title="Cancel connection anchor"
                              aria-label="Cancel connection anchor"
                              onClick={(event) => {
                                event.stopPropagation();
                                onRemoveCallAnchor(codeNode.id, anchor.id);
                              }}
                            >
                              <X size={11} />
                            </button>
                          )}
                        </span>
                        );
                      })}
                    </span>
                  );
                })}
              </pre>
            </div>
          )}
        </div>
      )}
    </section>
  );
});
