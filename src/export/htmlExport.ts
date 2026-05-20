import type { CodeTrailDocument } from '../model/types';

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function jsonForScript(document: CodeTrailDocument): string {
  return JSON.stringify(document).replace(/</g, '\\u003c');
}

export function generateStaticHtml(document: CodeTrailDocument): string {
  const title = escapeHtml(document.metadata.title);
  const data = jsonForScript(document);

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${title}</title>
  <style>
    :root { color-scheme: light; font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
    * { box-sizing: border-box; }
    body { margin: 0; background: #f7f7f5; color: #172033; overflow: hidden; }
    .toolbar { height: 48px; display: flex; gap: 8px; align-items: center; padding: 0 14px; border-bottom: 1px solid #d7dbe3; background: #ffffff; }
    .toolbar strong { margin-right: auto; font-size: 14px; }
    button { border: 1px solid #c8ceda; background: #fff; border-radius: 6px; padding: 6px 10px; font: inherit; cursor: pointer; }
    #viewport { height: calc(100vh - 48px); overflow: hidden; cursor: grab; position: relative; }
    #viewport.dragging { cursor: grabbing; }
    #world { position: absolute; left: 0; top: 0; transform-origin: 0 0; width: 5000px; height: 4000px; }
    svg { position: absolute; inset: 0; width: 5000px; height: 4000px; overflow: visible; pointer-events: none; }
    .scope { position: absolute; border: 2px dashed color-mix(in srgb, var(--scope-color), #1f2937 25%); background: color-mix(in srgb, var(--scope-color), transparent 74%); border-radius: 8px; padding: 10px; color: #111827; font-weight: 700; }
    .node { position: absolute; border: 1px solid #aab4c2; border-top: 5px solid var(--node-color); background: #fff; border-radius: 8px; box-shadow: 0 12px 28px rgba(24, 32, 44, .13); overflow: hidden; }
    .node-header { display: flex; align-items: center; gap: 8px; padding: 10px 12px; border-bottom: 1px solid #edf0f4; }
    .node-title { font-weight: 800; flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .node-meta { font-size: 12px; color: #526071; }
    .node-summary { padding: 8px 12px; color: #334155; font-size: 13px; line-height: 1.45; }
    pre { margin: 0; padding: 10px 12px 14px; overflow: auto; max-height: 210px; background: #0f172a; color: #e5e7eb; font: 12px/1.5 "SFMono-Regular", Consolas, "Liberation Mono", monospace; }
    .line { display: block; min-height: 18px; position: relative; white-space: pre; }
    .line.anchor { background: rgba(96, 165, 250, .18); outline: 1px solid rgba(96, 165, 250, .3); border-radius: 3px; }
    .anchor-pill { display: inline-block; margin-left: 8px; padding: 1px 6px; background: #dbeafe; color: #1d4ed8; border-radius: 999px; font: 11px system-ui; vertical-align: middle; }
    .collapsed { height: auto !important; }
    .collapsed pre { display: none; }
  </style>
</head>
<body>
  <div class="toolbar">
    <strong>${title}</strong>
    <button id="zoomOut">-</button>
    <button id="zoomIn">+</button>
    <button id="reset">Reset</button>
  </div>
  <div id="viewport"><div id="world"><svg id="edges"></svg><div id="scopes"></div><div id="nodes"></div></div></div>
  <script id="codetrail-data" type="application/json">${data}</script>
  <script>
    const documentData = JSON.parse(document.getElementById('codetrail-data').textContent);
    const viewport = document.getElementById('viewport');
    const world = document.getElementById('world');
    const scopesEl = document.getElementById('scopes');
    const nodesEl = document.getElementById('nodes');
    const edgesEl = document.getElementById('edges');
    let transform = { x: documentData.viewport.x || 0, y: documentData.viewport.y || 0, zoom: documentData.viewport.zoom || 1 };
    const collapsed = new Set(documentData.nodes.filter((node) => node.collapsed).map((node) => node.id));

    function applyTransform() {
      world.style.transform = 'translate(' + transform.x + 'px,' + transform.y + 'px) scale(' + transform.zoom + ')';
    }
    function lineY(node, anchor) {
      const header = 48;
      const summary = node.summary ? 44 : 10;
      return node.position.y + header + summary + anchor.line * 18 + 6;
    }
    function renderEdges() {
      edgesEl.innerHTML = '';
      for (const edge of documentData.edges) {
        const source = documentData.nodes.find((node) => node.id === edge.sourceNodeId);
        const target = documentData.nodes.find((node) => node.id === edge.targetNodeId);
        const anchor = source && source.callAnchors.find((item) => item.id === edge.sourceAnchorId);
        if (!source || !target || !anchor) continue;
        const x1 = source.position.x + source.size.width;
        const y1 = collapsed.has(source.id) ? source.position.y + 42 : lineY(source, anchor);
        const x2 = target.position.x;
        const y2 = target.position.y + 35;
        const dx = Math.max(80, Math.abs(x2 - x1) * 0.45);
        const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        path.setAttribute('d', 'M ' + x1 + ' ' + y1 + ' C ' + (x1 + dx) + ' ' + y1 + ', ' + (x2 - dx) + ' ' + y2 + ', ' + x2 + ' ' + y2);
        path.setAttribute('fill', 'none');
        path.setAttribute('stroke', edge.color);
        path.setAttribute('stroke-width', '2.5');
        edgesEl.appendChild(path);
      }
    }
    function renderScopes() {
      scopesEl.innerHTML = '';
      for (const scope of documentData.scopes) {
        const el = document.createElement('div');
        el.className = 'scope';
        el.style.cssText = '--scope-color:' + scope.color + '; left:' + scope.bounds.x + 'px; top:' + scope.bounds.y + 'px; width:' + scope.bounds.width + 'px; height:' + scope.bounds.height + 'px;';
        el.textContent = scope.title;
        scopesEl.appendChild(el);
      }
    }
    function renderNodes() {
      nodesEl.innerHTML = '';
      for (const node of documentData.nodes) {
        const el = document.createElement('section');
        el.className = 'node' + (collapsed.has(node.id) ? ' collapsed' : '');
        el.style.cssText = '--node-color:' + node.color + '; left:' + node.position.x + 'px; top:' + node.position.y + 'px; width:' + node.size.width + 'px; min-height:86px;';
        const lines = node.codeSnapshot.split('\\n').map((line, index) => {
          const lineNo = index + 1;
          const anchor = node.callAnchors.find((item) => item.line === lineNo);
          return '<span class="line ' + (anchor ? 'anchor' : '') + '">' + escapeHtml(line) + (anchor ? '<span class="anchor-pill">' + escapeHtml(anchor.label) + '</span>' : '') + '</span>';
        }).join('');
        el.innerHTML = '<div class="node-header"><button data-collapse="' + node.id + '">' + (collapsed.has(node.id) ? 'Expand' : 'Collapse') + '</button><div class="node-title">' + escapeHtml(node.title) + '</div><div class="node-meta">' + escapeHtml(node.language) + '</div></div><div class="node-summary">' + escapeHtml(node.summary || 'No summary yet.') + '</div><pre>' + lines + '</pre>';
        nodesEl.appendChild(el);
      }
      nodesEl.querySelectorAll('[data-collapse]').forEach((button) => {
        button.addEventListener('click', () => {
          const id = button.getAttribute('data-collapse');
          if (collapsed.has(id)) collapsed.delete(id); else collapsed.add(id);
          renderNodes();
          renderEdges();
        });
      });
    }
    function escapeHtml(value) {
      return String(value).replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
    }
    let drag = null;
    viewport.addEventListener('pointerdown', (event) => {
      drag = { x: event.clientX, y: event.clientY, tx: transform.x, ty: transform.y };
      viewport.classList.add('dragging');
    });
    window.addEventListener('pointermove', (event) => {
      if (!drag) return;
      transform.x = drag.tx + event.clientX - drag.x;
      transform.y = drag.ty + event.clientY - drag.y;
      applyTransform();
    });
    window.addEventListener('pointerup', () => {
      drag = null;
      viewport.classList.remove('dragging');
    });
    viewport.addEventListener('wheel', (event) => {
      event.preventDefault();
      transform.zoom = Math.min(2.5, Math.max(0.25, transform.zoom + (event.deltaY > 0 ? -0.08 : 0.08)));
      applyTransform();
    }, { passive: false });
    document.getElementById('zoomOut').onclick = () => { transform.zoom = Math.max(.25, transform.zoom - .1); applyTransform(); };
    document.getElementById('zoomIn').onclick = () => { transform.zoom = Math.min(2.5, transform.zoom + .1); applyTransform(); };
    document.getElementById('reset').onclick = () => { transform = { x: 0, y: 0, zoom: 1 }; applyTransform(); };
    renderScopes();
    renderNodes();
    renderEdges();
    applyTransform();
  </script>
</body>
</html>`;
}
