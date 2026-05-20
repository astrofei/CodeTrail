# CodeTrail Agent Guide

CodeTrail is a local-first code-reading graph editor for Windows and macOS. Its first version helps a reader manually preserve a call-chain review and module map as an interactive visual document.

## Product Contract

- The first screen is the editor canvas. Do not build a landing page or marketing wrapper.
- Code blocks represent functions or methods. The user pastes a code snapshot manually; v1 does not parse repositories automatically.
- A call relationship starts from a concrete call anchor inside a source code block and points to another code block.
- Scopes are visible, named, colorable grouping regions that show module or responsibility boundaries.
- Nodes, scopes, and edges can each have their own color.
- Nodes can be expanded or collapsed. Expanded nodes show code; collapsed nodes show the code block summary, key metadata, and compact call-anchor chips.
- The app must remain local-first. Source code is stored only in local project files and user-initiated static HTML exports.
- Do not add cloud sync, analytics, Notion API writes, or automatic uploads without a new explicit product decision.

## Canvas Interaction Contract

This section is product-critical. The user repeatedly refined these rules, so preserve them unless a later explicit product decision replaces them.

### Node Dragging and Scope Membership

- Dragging a code node must feel free and direct. During the drag, do not move, expand, shrink, or otherwise mutate scopes.
- Scope membership is settled only after the node's final position is known, normally on `onNodeDragStop`.
- After a node is dropped, decide membership from final geometry:
  - If the dropped node intersects any scope, assign the node to that scope.
  - If multiple scopes intersect, use the first deterministic scope from document order unless a later UI lets the user choose.
  - If the node was previously assigned to a scope and no longer intersects any scope, set `scopeId` to `null`.
- After membership is settled, recompute every affected scope exactly once.
  - Affected scopes include the old scope, the new scope, or both when they differ.
  - Recompute from all nodes whose `scopeId` equals that scope.
- Scope recompute must both expand and shrink.
  - Expand when a dropped node is partly inside the scope and does not fit.
  - Shrink when a node leaves or moves inward, as long as all remaining assigned nodes still fit.
  - Do not leave stale oversized bounds just because a scope was larger earlier.
- A node must always be draggable out of a scope. Avoid any drag-time behavior that makes the scope chase the node and effectively traps it.
- A node dragged from outside into a scope should be accepted when any part of its final rectangle intersects the scope.
- Scope auto-resize is a post-drop layout result, not a live drag constraint.

### Scope Geometry

- Scopes are visual grouping regions with semantic membership. Nodes inside a scope share that scope's responsibility/module context.
- Scopes should not clip, constrain, or parent code nodes in the React Flow hierarchy unless the entire drag/membership model is redesigned.
- Scope bounds are stored independently in `Scope.bounds`; code nodes keep absolute canvas positions.
- When a scope is dragged, every code node whose `scopeId` equals that scope id must move by the same delta.
- Scope dragging must persist both the new `Scope.bounds` position and the moved member nodes' `CodeNode.position` values.
- Dragging a scope should not change membership by itself; it moves the scope and its current members as a group.
- Nodes that only visually overlap a dragged scope but do not have that `scopeId` must not be moved by the scope drag.
- When computing automatic scope bounds, use the smallest rectangle that can contain all assigned nodes, plus padding.
- Reserve extra space at the top of automatic scope bounds for the scope title label so nodes do not cover the title.
- Scope titles must remain visible. Render them as a distinct label/chip rather than plain text that can be hidden behind nodes.
- Manual scope resizing is allowed. A later node drop may still recompute the scope from assigned nodes if membership changes or the node movement affects that scope.

### Resizing

- Code nodes and scopes must be resizable when selected.
- Persist node resize to `CodeNode.size`; persist scope resize to `Scope.bounds`.
- If a resize handle can change x/y as well as width/height, persist both position and size.
- Collapsed code nodes should not expose resize handles; resizing collapsed nodes can accidentally corrupt the saved expanded size.
- Expanded node size is the durable user-controlled size. Collapsed visual size may be compact and derived.

### Collapse and Edge Anchors

- Collapsing a node must make the node visually compact. Do not merely hide code while leaving the expanded node height behind.
- Expanded dimensions should be preserved and restored when the node is expanded again.
- Edges must remain attached after collapse.
- Because source handles inside hidden code lines disappear when the code body is unmounted, collapsed nodes must render compact call-anchor chips that keep the same source handle ids.
- Target handles should remain on the compact collapsed node geometry so incoming lines do not appear to connect to empty space.
- If edge placement looks wrong after collapse, fix the collapsed node geometry and handles rather than hiding the edge.

## Technology Direction

- Desktop shell: Tauri 2.
- Frontend: React, TypeScript, Vite.
- Canvas: `@xyflow/react`, using custom node types for code nodes and scopes.
- Keep graph editing, document validation, and HTML export logic in frontend/shared TypeScript wherever possible so the desktop editor and exported viewer do not drift.
- Tauri should own native file open/save/export behavior and window integration.

## Document Model

CodeTrail projects are single `.codetrail.json` files so they are portable, diffable, and easy to back up.

Required top-level shape:

- `CodeTrailDocument`: `version`, `metadata`, `nodes`, `edges`, `scopes`, `viewport`
- `CodeNode`: `id`, `title`, `language`, `summary`, `codeSnapshot`, `position`, `size`, `collapsed`, `color`, `scopeId`, `callAnchors`
- `CallAnchor`: `id`, `label`, `line`, `startColumn`, `endColumn`
- `Edge`: `id`, `sourceNodeId`, `sourceAnchorId`, `targetNodeId`, `label`, `color`
- `Scope`: `id`, `title`, `color`, `bounds`

Validation must reject edges that do not reference an existing source node, source call anchor, and target node.

## Current Implementation Notes

- `src/ui/App.tsx` owns the editor-level document state, React Flow state, file actions, and scope-membership settlement.
- `src/ui/flowMapping.ts` maps `CodeTrailDocument` data into React Flow nodes and edges. Keep this mapping deterministic.
- `src/ui/CodeNodeView.tsx` owns expanded/collapsed node rendering, call-anchor handles, and node resizing.
- `src/ui/ScopeNodeView.tsx` owns scope rendering, the visible scope title label, and scope resizing.
- `src/model/document.ts`, `src/model/schema.ts`, and `src/model/operations.ts` own model creation, validation, serialization, and pure document operations.
- `src/export/htmlExport.ts` owns the self-contained static HTML viewer. Any editor behavior that is also required in Notion viewing should be reflected there.

## Export Contract

- Export must produce a self-contained HTML file with embedded document data, styles, and viewer behavior.
- Exported HTML must support zooming, panning, node collapse/expand, and visible scope/node/edge colors.
- The Notion path is: export static HTML, host it somewhere the user controls, then embed that URL in Notion.
- Exported viewing must not depend on a backend service.
- Exported collapsed nodes must keep edge readability. The viewer should not regress to lines pointing at empty expanded-space geometry.
- Exported scopes should keep title visibility and should not let titles become visually buried under code nodes.

## Testing Expectations

- Unit tests cover document validation, node/edge/scope operations, call-anchor edge validity, and collapse-state serialization.
- Export tests confirm the generated HTML contains the same document data and viewer behavior entrypoints.
- Editor tests cover node collapse/expand, color editing, scope assignment, resizing, drag/drop scope settlement, and call-anchor edge creation where practical.
- Add or update regression coverage when changing:
  - node drag/drop behavior
  - scope auto-resize behavior
  - collapsed node geometry
  - call-anchor handle rendering
  - export viewer geometry
- Before reporting completion, run TypeScript checks and the available test suite.
- For UI behavior changes, also refresh the local browser target and verify the visible page state when practical.

## Known UX Pitfalls To Avoid

- Do not update scope bounds continuously while a node is being dragged. Earlier attempts made the scope chase the node and prevented the user from dragging out naturally.
- Do not base "drag out" on a dynamically expanded scope boundary. That makes each expansion increase the distance required to leave the scope.
- Do not let scope dragging move only the scope rectangle while leaving assigned nodes behind; that breaks the meaning of membership.
- Do not move visually overlapping nodes during scope drag unless their `scopeId` matches the dragged scope.
- Do not remove handles when collapsing nodes; edges will disconnect or appear to fly to the wrong place.
- Do not leave collapsed nodes at their expanded height; incoming and outgoing lines will appear attached to empty space.
- Do not put the scope title as ordinary text inside the scope body where nodes can cover it.
- Do not make scopes React Flow parents of code nodes unless the entire membership and dragging model is redesigned.
