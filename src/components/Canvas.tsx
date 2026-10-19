"use client";

import { useEffect, useLayoutEffect, useRef, useState, type Dispatch, type PointerEvent } from "react";
import type { EvaluatedGraph } from "@/model/actions";
import type { HeuristicTable } from "@/model/heuristics/registry";
import type { Edge, StateNode } from "@/model/schema";
import type { EditorAction, EditorState } from "@/state/editorReducer";
import { formatNumber } from "./format";
import { useCoarsePointer } from "./useCoarsePointer";
import styles from "./Editor.module.css";

const R = 22; // node radius in px
const MIN_ZOOM = 0.2;
const MAX_ZOOM = 4;
/** Pointer travel (px) below which a press counts as a tap rather than a drag. */
const TAP_SLOP = 6;
const DOUBLE_TAP_MS = 350;

interface View {
  x: number;
  y: number;
  zoom: number;
}

/** What a press on empty canvas does if it ends without moving. */
type TapAction = "add-node" | "cancel-edge" | "deselect" | null;

type Drag =
  | { kind: "node"; id: string; dx: number; dy: number; clientX: number; clientY: number; moved: boolean }
  | { kind: "pan"; clientX: number; clientY: number; view: View; moved: boolean; tap: TapAction }
  | { kind: "pinch"; dist: number; cx: number; cy: number; view: View }
  | null;

type Point = { x: number; y: number };

/**
 * How the “Change length” and “Change h(n)” tools use the canvas: clickable edges while choosing,
 * then a preview of the new layout.
 */
export interface CanvasOverlay {
  kind: "length" | "h";
  phase: "choose" | "preview";
  /** The edited edge (and its opposite one-way edge). */
  targetEdgeIds: ReadonlySet<string>;
  /** The state whose h is being set. */
  targetNodeId?: string;
  /** Edges that can be clicked: they toggle a lock (length) or pick the edge to keep (h). */
  affected: ReadonlySet<string>;
  /** Edges that keep their length. */
  locked: ReadonlySet<string>;
  /** Edges whose length changes in the preview. */
  changed?: ReadonlySet<string>;
  /** Current positions of states that move in the preview (the canvas shows the new ones). */
  ghosts?: { id: string; x: number; y: number }[];
  /** The circle a state moves along (px). */
  guide?: { cx: number; cy: number; r: number };
  onEdgeClick: (edgeId: string) => void;
}

interface Props {
  state: EditorState;
  dispatch: Dispatch<EditorAction>;
  evaluated: EvaluatedGraph;
  heuristic: HeuristicTable | null;
  showH: boolean;
  snap: boolean;
  onRequestRename: (nodeId: string) => void;
  /** While set, states can't be selected or dragged and edge clicks toggle locks. */
  overlay?: CanvasOverlay;
}

export default function Canvas({ state, dispatch, evaluated, heuristic, showH, snap, onRequestRename, overlay }: Props) {
  const { graph, problem, selection, mode, pendingEdgeFrom } = state;
  const svgRef = useRef<SVGSVGElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 800, h: 600 });
  const [view, setView] = useState<View>({ x: 0, y: 0, zoom: 1 });
  const [drag, setDrag] = useState<Drag>(null);
  const [cursor, setCursor] = useState<Point | null>(null);
  const coarse = useCoarsePointer();
  // Active pointers in client coordinates, for two-finger pinch/pan.
  const pointers = useRef(new Map<number, Point>());
  const lastTap = useRef<{ id: string; t: number } | null>(null);

  // Track the canvas size so the viewBox keeps a 1:1 pixel ratio at zoom 1.
  useLayoutEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    let prev: { w: number; h: number } | null = null;
    const ro = new ResizeObserver(([entry]) => {
      const next = { w: Math.max(1, entry.contentRect.width), h: Math.max(1, entry.contentRect.height) };
      // Keep the centre of the view in place, e.g. when the phone's bottom sheet opens or closes.
      if (prev) {
        const { w, h } = prev;
        setView((v) => ({ ...v, x: v.x + (w - next.w) / 2 / v.zoom, y: v.y + (h - next.h) / 2 / v.zoom }));
      }
      prev = next;
      setSize(next);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Wheel zoom around the cursor (native listener: React's onWheel is passive).
  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = svg.getBoundingClientRect();
      const factor = Math.exp(-e.deltaY * 0.0015);
      setView((v) => {
        const zoom = clamp(v.zoom * factor, MIN_ZOOM, MAX_ZOOM);
        const wx = v.x + (e.clientX - rect.left) / v.zoom;
        const wy = v.y + (e.clientY - rect.top) / v.zoom;
        return { zoom, x: wx - (e.clientX - rect.left) / zoom, y: wy - (e.clientY - rect.top) / zoom };
      });
    };
    // The canvas works on pointer events only. Suppress the mouse events and click the browser
    // synthesises after a touch; they would land on whatever a tap just opened (e.g. the bottom sheet).
    const onTouchEnd = (e: TouchEvent) => e.preventDefault();
    svg.addEventListener("wheel", onWheel, { passive: false });
    svg.addEventListener("touchend", onTouchEnd, { passive: false });
    return () => {
      svg.removeEventListener("wheel", onWheel);
      svg.removeEventListener("touchend", onTouchEnd);
    };
  }, []);

  const toWorld = (e: { clientX: number; clientY: number }) => {
    const rect = svgRef.current!.getBoundingClientRect();
    return { x: view.x + (e.clientX - rect.left) / view.zoom, y: view.y + (e.clientY - rect.top) / view.zoom };
  };

  const snapPoint = (p: { x: number; y: number }) => {
    if (!snap) return p;
    const step = graph.pxPerUnit / 4;
    return { x: Math.round(p.x / step) * step, y: Math.round(p.y / step) * step };
  };

  // Capture the pointer only once it moves, so plain clicks / double-clicks still reach the node.
  const capture = (e: PointerEvent) => {
    const svg = svgRef.current;
    if (svg && !svg.hasPointerCapture(e.pointerId)) svg.setPointerCapture(e.pointerId);
  };

  const pinchFrom = (v: View): Drag => {
    const [a, b] = [...pointers.current.values()];
    return { kind: "pinch", dist: Math.hypot(b.x - a.x, b.y - a.y) || 1, cx: (a.x + b.x) / 2, cy: (a.y + b.y) / 2, view: v };
  };

  // Runs before the node/edge handlers: a second finger turns whatever is going on into a pinch.
  const onDownCapture = (e: PointerEvent<SVGSVGElement>) => {
    // Commit a field being edited (e.g. a state name) before the canvas changes the selection.
    // Touch taps don't blur it themselves, because the canvas suppresses the follow-up mouse events.
    const active = document.activeElement;
    if (active instanceof HTMLElement && active !== document.body) active.blur();
    if (e.pointerType === "mouse") return;
    // The first finger down: forget pointers whose up/cancel never reached the canvas.
    if (e.isPrimary) pointers.current.clear();
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.current.size === 2) {
      e.stopPropagation();
      setDrag(pinchFrom(view));
    } else if (pointers.current.size > 2) e.stopPropagation();
  };

  const onBackgroundDown = (e: PointerEvent<SVGSVGElement>) => {
    if (e.button !== 0 && e.button !== 1) return;
    // Empty canvas always pans when dragged; a plain tap/click does the current tool's action.
    const tap: TapAction =
      e.button === 1 || overlay
        ? null
        : mode === "add-node"
          ? "add-node"
          : mode === "add-edge"
            ? "cancel-edge"
            : "deselect";
    setDrag({ kind: "pan", clientX: e.clientX, clientY: e.clientY, view, moved: false, tap });
  };

  const onNodeDown = (e: PointerEvent, node: StateNode) => {
    if (e.button !== 0 || overlay) return; // with an overlay the press pans the canvas instead
    e.stopPropagation();
    if (mode === "add-edge") {
      if (pendingEdgeFrom === null) dispatch({ type: "setPendingEdge", from: node.id });
      else dispatch({ type: "addEdge", from: pendingEdgeFrom, to: node.id });
      return;
    }
    dispatch({ type: "select", selection: { kind: "node", id: node.id } });
    const p = toWorld(e);
    setDrag({ kind: "node", id: node.id, dx: p.x - node.x, dy: p.y - node.y, clientX: e.clientX, clientY: e.clientY, moved: false });
  };

  const onEdgeDown = (e: PointerEvent, edge: Edge) => {
    if (e.button !== 0) return;
    if (overlay) {
      if (!overlay.affected.has(edge.id)) return;
      e.stopPropagation();
      overlay.onEdgeClick(edge.id);
      return;
    }
    e.stopPropagation();
    if (mode === "add-edge") dispatch({ type: "setPendingEdge", from: null });
    dispatch({ type: "select", selection: { kind: "edge", id: edge.id } });
  };

  const onMove = (e: PointerEvent<SVGSVGElement>) => {
    if (pointers.current.has(e.pointerId)) pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const p = toWorld(e);
    setCursor(p);
    if (drag) capture(e);
    if (drag?.kind === "pinch") {
      if (pointers.current.size < 2) return;
      const [a, b] = [...pointers.current.values()];
      const rect = svgRef.current!.getBoundingClientRect();
      const zoom = clamp((drag.view.zoom * Math.hypot(b.x - a.x, b.y - a.y)) / drag.dist, MIN_ZOOM, MAX_ZOOM);
      // Keep the world point that was under the fingers' midpoint under the new midpoint.
      const wx = drag.view.x + (drag.cx - rect.left) / drag.view.zoom;
      const wy = drag.view.y + (drag.cy - rect.top) / drag.view.zoom;
      const cx = (a.x + b.x) / 2;
      const cy = (a.y + b.y) / 2;
      setView({ zoom, x: wx - (cx - rect.left) / zoom, y: wy - (cy - rect.top) / zoom });
    } else if (drag?.kind === "node") {
      // Ignore finger jitter during a tap: the state only follows once the pointer leaves the slop.
      if (!drag.moved) {
        if (Math.hypot(e.clientX - drag.clientX, e.clientY - drag.clientY) <= TAP_SLOP) return;
        setDrag({ ...drag, moved: true });
      }
      const target = snapPoint({ x: p.x - drag.dx, y: p.y - drag.dy });
      const node = evaluated.nodeById.get(drag.id);
      if (node && (node.x !== target.x || node.y !== target.y))
        dispatch({ type: "moveNode", id: drag.id, x: target.x, y: target.y });
    } else if (drag?.kind === "pan") {
      const moved = drag.moved || Math.hypot(e.clientX - drag.clientX, e.clientY - drag.clientY) > TAP_SLOP;
      if (!moved) return;
      if (!drag.moved) setDrag({ ...drag, moved: true });
      setView({
        ...drag.view,
        x: drag.view.x - (e.clientX - drag.clientX) / drag.view.zoom,
        y: drag.view.y - (e.clientY - drag.clientY) / drag.view.zoom,
      });
    }
  };

  const onUp = (e: PointerEvent<SVGSVGElement>) => {
    pointers.current.delete(e.pointerId);
    if (drag?.kind === "pan" && !drag.moved) {
      if (drag.tap === "add-node") {
        const p = snapPoint(toWorld(e));
        dispatch({ type: "addNode", x: p.x, y: p.y });
      } else if (drag.tap === "cancel-edge") dispatch({ type: "setPendingEdge", from: null });
      else if (drag.tap === "deselect") dispatch({ type: "select", selection: null });
    }
    // Touch screens have no reliable dblclick: two taps (no drag) on the same state rename it.
    if (drag?.kind === "node" && !drag.moved && e.pointerType !== "mouse") {
      const prev = lastTap.current;
      if (prev?.id === drag.id && e.timeStamp - prev.t < DOUBLE_TAP_MS) {
        lastTap.current = null;
        onRequestRename(drag.id);
      } else lastTap.current = { id: drag.id, t: e.timeStamp };
    } else if (drag?.kind === "node") lastTap.current = null;
    // Lifting one finger of a pinch ends it; the other finger does nothing until lifted.
    setDrag(null);
    if (e.pointerType !== "mouse") setCursor(null);
  };

  const onCancel = (e: PointerEvent<SVGSVGElement>) => {
    pointers.current.delete(e.pointerId);
    setDrag(null);
    if (e.pointerType !== "mouse") setCursor(null);
  };

  const zoomBy = (factor: number) =>
    setView((v) => {
      const zoom = clamp(v.zoom * factor, MIN_ZOOM, MAX_ZOOM);
      const cx = v.x + size.w / 2 / v.zoom;
      const cy = v.y + size.h / 2 / v.zoom;
      return { zoom, x: cx - size.w / 2 / zoom, y: cy - size.h / 2 / zoom };
    });

  const fit = () => {
    if (graph.nodes.length === 0) return setView({ x: 0, y: 0, zoom: 1 });
    const xs = graph.nodes.map((n) => n.x);
    const ys = graph.nodes.map((n) => n.y);
    const pad = 80;
    const minX = Math.min(...xs) - pad;
    const minY = Math.min(...ys) - pad;
    const w = Math.max(...xs) + pad - minX;
    const h = Math.max(...ys) + pad - minY;
    const zoom = clamp(Math.min(size.w / w, size.h / h), MIN_ZOOM, 1.5);
    setView({ zoom, x: minX - (size.w / zoom - w) / 2, y: minY - (size.h / zoom - h) / 2 });
  };

  const viewW = size.w / view.zoom;
  const viewH = size.h / view.zoom;
  const unit = graph.pxPerUnit;
  const pending = pendingEdgeFrom ? evaluated.nodeById.get(pendingEdgeFrom) : undefined;

  return (
    <div className={styles.canvasWrap} ref={wrapRef}>
      <svg
        ref={svgRef}
        className={styles.canvas}
        data-mode={mode}
        data-panning={(drag?.kind === "pan" && drag.moved) || drag?.kind === "pinch"}
        viewBox={`${view.x} ${view.y} ${viewW} ${viewH}`}
        onPointerDownCapture={onDownCapture}
        onPointerDown={onBackgroundDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerCancel={onCancel}
        onPointerLeave={() => setCursor(null)}
        aria-label="State-space graph canvas"
        role="application"
      >
        <defs>
          <pattern id="grid" width={unit} height={unit} patternUnits="userSpaceOnUse">
            {[1, 2, 3].map((i) => (
              <g key={i} className={styles.gridMinor}>
                <line x1={(unit * i) / 4} y1={0} x2={(unit * i) / 4} y2={unit} />
                <line x1={0} y1={(unit * i) / 4} x2={unit} y2={(unit * i) / 4} />
              </g>
            ))}
            <path d={`M ${unit} 0 L 0 0 0 ${unit}`} fill="none" className={styles.gridMajor} />
          </pattern>
          {(["arrow", "arrowSelected", "arrowError"] as const).map((cls) => (
            <marker key={cls} id={cls} viewBox="0 0 10 10" refX={9} refY={5} markerWidth={8} markerHeight={8} orient="auto-start-reverse">
              <path d="M0,0 L10,5 L0,10 z" className={styles[cls]} />
            </marker>
          ))}
        </defs>
        <rect x={view.x} y={view.y} width={viewW} height={viewH} fill="url(#grid)" />

        {graph.edges.map((edge) => (
          <EdgeView
            key={edge.id}
            edge={edge}
            state={state}
            evaluated={evaluated}
            selected={selection?.kind === "edge" && selection.id === edge.id}
            look={overlay && edgeLook(overlay, edge.id)}
            onPointerDown={(e) => onEdgeDown(e, edge)}
          />
        ))}

        {overlay?.guide && (
          <circle className={styles.guideCircle} cx={overlay.guide.cx} cy={overlay.guide.cy} r={overlay.guide.r} />
        )}

        {overlay?.ghosts?.map((ghost) => {
          const now = evaluated.nodeById.get(ghost.id);
          return (
            now && (
              <g key={`ghost-${ghost.id}`} className={styles.ghost}>
                <line x1={ghost.x} y1={ghost.y} x2={now.x} y2={now.y} />
                <circle cx={ghost.x} cy={ghost.y} r={R} />
              </g>
            )
          );
        })}

        {pending && cursor && (
          <line className={styles.rubberBand} x1={pending.x} y1={pending.y} x2={cursor.x} y2={cursor.y} />
        )}

        {graph.nodes.map((node) => {
          const isSelected = selection?.kind === "node" && selection.id === node.id;
          const isInitial = problem.initial === node.id;
          const isGoal = problem.goal === node.id;
          const h = heuristic?.values[node.id];
          const classes = [styles.node, isSelected && styles.nodeSelected, pendingEdgeFrom === node.id && styles.nodePending];
          return (
            <g
              key={node.id}
              className={classes.filter(Boolean).join(" ")}
              transform={`translate(${node.x} ${node.y})`}
              onPointerDown={(e) => onNodeDown(e, node)}
              onDoubleClick={() => !overlay && onRequestRename(node.id)}
            >
              <title>{node.name}</title>
              {isInitial && <circle r={R + 5} className={styles.ringInitial} />}
              {isGoal && (
                <>
                  <circle r={R + 5} className={styles.ringGoal} />
                  <circle r={R + 10} className={styles.ringGoal} strokeWidth={1.5} />
                </>
              )}
              {overlay?.targetNodeId === node.id && <circle r={R + 7} className={styles.targetRing} />}
              <circle r={R + 8} className={styles.nodeHit} />
              <circle r={R} className={styles.nodeCircle} />
              <text className={styles.nodeName} textAnchor="middle" dominantBaseline="central">
                {truncate(node.name, 6)}
              </text>
              {(isInitial || isGoal) && (
                <text
                  className={styles.roleLabel}
                  y={-R - 14}
                  textAnchor="middle"
                  fill={isGoal ? "var(--goal)" : "var(--initial)"}
                >
                  {isInitial && isGoal ? "start · goal" : isInitial ? "start" : "goal"}
                </text>
              )}
              {showH && h !== undefined && (
                <text className={`${styles.hLabel} ${h === null ? styles.hLabelBad : ""}`} y={R + (isGoal ? 24 : 18)} textAnchor="middle">
                  h={h === null ? "⚠" : formatNumber(h)}
                </text>
              )}
            </g>
          );
        })}
      </svg>

      <div className={styles.hint}>
        {overlay ? overlayHint(overlay, coarse, evaluated.nodeById.get(overlay.targetNodeId ?? "")?.name) : hintFor(state, coarse)}
      </div>

      <div className={styles.overlay}>
        <div>
          <div className={styles.scaleBar} style={{ width: unit * view.zoom }} />
          1 unit = {formatNumber(unit)} px
        </div>
        {cursor && (
          <div>
            ({formatNumber(cursor.x / unit)}, {formatNumber(cursor.y / unit)})
          </div>
        )}
        <div>{Math.round(view.zoom * 100)}%</div>
      </div>

      <div className={styles.zoomControls}>
        <button onClick={() => zoomBy(1 / 1.25)} title="Zoom out" aria-label="Zoom out">−</button>
        <button onClick={() => zoomBy(1.25)} title="Zoom in" aria-label="Zoom in">+</button>
        <button onClick={fit} title="Fit graph to view">Fit</button>
      </div>
    </div>
  );
}

type EdgeLook = "target" | "locked" | "changed" | "lockable" | "dim";

function edgeLook(overlay: CanvasOverlay, id: string): EdgeLook {
  if (overlay.targetEdgeIds.has(id)) return "target";
  if (overlay.changed?.has(id)) return "changed";
  if (overlay.locked.has(id)) return "locked";
  return overlay.affected.has(id) ? "lockable" : "dim";
}

function EdgeView({
  edge,
  state,
  evaluated,
  selected,
  look,
  onPointerDown,
}: {
  edge: Edge;
  state: EditorState;
  evaluated: EvaluatedGraph;
  selected: boolean;
  look?: EdgeLook;
  onPointerDown: (e: PointerEvent) => void;
}) {
  const a = evaluated.nodeById.get(edge.from);
  const b = evaluated.nodeById.get(edge.to);
  const info = evaluated.edges[edge.id];
  if (!a || !b || !info) return null;

  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy) || 1;
  const ux = dx / len;
  const uy = dy / len;
  // Perpendicular (to the right of the direction of travel).
  const px = -uy;
  const py = ux;
  // Opposite one-way edges are drawn side by side.
  const hasOpposite = state.graph.edges.some((e) => e.from === edge.to && e.to === edge.from);
  const off = hasOpposite ? 7 : 0;
  const startGap = R;
  const endGap = edge.directed ? R + 3 : R;
  const x1 = a.x + ux * startGap + px * off;
  const y1 = a.y + uy * startGap + py * off;
  const x2 = b.x - ux * endGap + px * off;
  const y2 = b.y - uy * endGap + py * off;

  const friction = state.graph.costModel.kind === "builtin" && state.graph.costModel.id === "euclidean" && edge.friction > 1;
  const error = info.forward.error ?? info.backward?.error;
  const label =
    (look === "locked" ? "🔒 " : "") +
    (error ? "⚠" : edgeLabel(info.forward.cost, info.backward?.cost) + (friction ? ` ×${formatNumber(edge.friction)}` : ""));
  // Horizontal text next to a steep edge needs to clear half its width.
  const halfWidth = label.length * 3.6;
  const labelOff = off + 10 + halfWidth * Math.abs(uy) + 4 * Math.abs(ux);
  // Keep the label on the "upper" side for readability on undirected edges.
  const flip = !hasOpposite && py > 0 ? -1 : 1;
  const lx = (a.x + b.x) / 2 + px * labelOff * flip;
  const ly = (a.y + b.y) / 2 + py * labelOff * flip;

  const markerId = error ? "arrowError" : selected ? "arrowSelected" : "arrow";
  const lookClass = look && { target: styles.edgeTarget, locked: styles.edgeLocked, changed: styles.edgeChanged, lockable: styles.edgeLockable, dim: styles.edgeDim }[look];
  const classes = [selected && !look && styles.edgeSelected, error && styles.edgeError, lookClass].filter(Boolean).join(" ");
  const fromName = a.name;
  const toName = b.name;

  return (
    <g className={classes} onPointerDown={onPointerDown}>
      <title>
        {`${fromName} ${edge.directed ? "→" : "↔"} ${toName}\nlength ${formatNumber(info.length)} units` +
          (edge.friction !== 1 ? `\nfriction ×${edge.friction}` : "") +
          (error ? `\n⚠ ${error}` : "")}
      </title>
      <line className={styles.edgeHit} x1={x1} y1={y1} x2={x2} y2={y2} />
      <line
        className={`${styles.edgeLine} ${friction ? styles.edgeFriction : ""}`}
        x1={x1}
        y1={y1}
        x2={x2}
        y2={y2}
        markerEnd={edge.directed ? `url(#${markerId})` : undefined}
      />
      <text
        className={`${styles.edgeLabel} ${error ? styles.edgeLabelError : ""}`}
        x={lx}
        y={ly}
        textAnchor="middle"
        dominantBaseline="central"
      >
        {label}
      </text>
    </g>
  );
}

function edgeLabel(forward: number | null, backward: number | null | undefined): string {
  const f = forward === null ? "?" : formatNumber(forward);
  if (backward === undefined) return f;
  if (backward !== null && forward !== null && Math.abs(backward - forward) < 1e-9) return f;
  return `${f} / ${backward === null ? "?" : formatNumber(backward)}`;
}

function overlayHint(overlay: CanvasOverlay, touch: boolean, name = ""): string {
  if (overlay.phase === "preview") return "Preview · dashed circles are the current positions";
  if (overlay.kind === "h") return `${touch ? "Tap" : "Click"} an edge of ${name} to keep its length`;
  return `${touch ? "Tap" : "Click"} highlighted edges to lock or unlock their length`;
}

function hintFor(state: EditorState, touch: boolean): string {
  if (touch) {
    switch (state.mode) {
      case "add-node":
        return "Tap to place a state";
      case "add-edge":
        return state.pendingEdgeFrom ? "Tap the target state" : "Tap the source state";
      default:
        return "Drag to move · pinch to zoom · double-tap to rename";
    }
  }
  switch (state.mode) {
    case "add-node":
      return "Click on empty canvas to place a state";
    case "add-edge":
      return state.pendingEdgeFrom ? "Click the target state (Esc to cancel)" : "Click the source state";
    default:
      return "Drag states to move · drag background to pan · wheel to zoom · double-click to rename";
  }
}

function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, n - 1) + "…" : s;
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}
