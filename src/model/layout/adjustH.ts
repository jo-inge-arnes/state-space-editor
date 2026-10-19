import { evaluateGraph } from "../actions";
import {
  computeHeuristicTable,
  lazyHeuristicContext,
  resolveHeuristic,
  type HeuristicTable,
} from "../heuristics/registry";
import type { Problem, StateSpaceGraph } from "../schema";
import { evaluateNumber } from "../userFunctions";
import type { BarInfo, ChangedBar } from "./adjustLength";
import { buildStructure, distance, otherEnd } from "./structure";

/** How the state may move: keep one of its edges, keep none, or try every way and rank them. */
export type HChoice = { kind: "any" } | { kind: "keep"; edgeId: string } | { kind: "free" };

/** One way to move the state: rotate about a neighbour (keeping that edge's length), or move freely. */
export interface HMove {
  kind: "keep" | "free";
  /** The kept edge(s) between the state and the pivot (an edge, or two opposite one-way edges). */
  kept?: BarInfo;
  pivot?: { id: string; name: string };
}

export interface HProposal {
  move: HMove;
  /** New position of the state in px. */
  position: { x: number; y: number };
  /** h of the state at the new position. */
  h: number;
  /** Distance moved, in units. */
  distance: number;
  /** E.g. "A rotates 12.3° clockwise about C". */
  motion: string;
  /** Other edges of the state whose length changes (units). */
  changed: ChangedBar[];
  /** Other states whose h changes (only for heuristics that look beyond the state itself). */
  hChanges: { id: string; name: string; before: number | null; after: number | null }[];
}

export interface HStats {
  ms: number;
  /** Number of times the heuristic was evaluated. */
  evaluations: number;
}

export type HResult =
  | { ok: true; proposals: HProposal[]; stats: HStats }
  | { ok: false; reason: "range"; min: number; max: number; closest: HProposal | null; stats: HStats }
  | { ok: false; reason: "constant"; value: number; stats: HStats }
  | { ok: false; reason: "invalid"; message: string };

const SAMPLES = 720; // 0.5° steps around a circle
const MAX_PROPOSALS = 6;

/** The ways a state can move: one rotation per neighbour (keeping that edge), plus a free move. */
export function hMoves(graph: StateSpaceGraph, nodeId: string): HMove[] {
  const s = buildStructure(graph);
  const v = s.indexOf.get(nodeId);
  if (v === undefined) return [];
  const keeps = s.incident[v].map((bar): HMove => {
    const b = s.bars[bar];
    const w = otherEnd(b, v);
    return {
      kind: "keep",
      kept: { edgeIds: b.edgeIds, a: s.names[v], b: s.names[w], length: b.length / graph.pxPerUnit },
      pivot: { id: s.ids[w], name: s.names[w] },
    };
  });
  return [...keeps, { kind: "free" }];
}

/**
 * Move one state so that the problem's heuristic gives `target` for it, keeping the length of one
 * of its edges (it rotates about that edge's other end) or of none (it moves in the direction in
 * which h changes fastest). All other states, including the goal, stay in place.
 *
 * The heuristic is treated as a black box, evaluated exactly like the h table (so straight-line,
 * Manhattan and user-defined functions all work, including ones that read costs from
 * ctx.actions). Each way of moving is a 1-D root search: sample the circle (or ray), bracket every
 * sign change of h − target, and refine it by bisection. Roots are accepted only where h really
 * equals the target, so a jump in a discontinuous function is not mistaken for a solution.
 */
export function adjustH(
  graph: StateSpaceGraph,
  problem: Problem,
  nodeId: string,
  target: number,
  choice: HChoice = { kind: "any" },
  { protectedEdges = [] }: { protectedEdges?: Iterable<string> } = {},
): HResult {
  const start = performance.now();
  const node = graph.nodes.find((n) => n.id === nodeId);
  if (!node) return invalid("Unknown state.");
  if (!problem.goal || !graph.nodes.some((n) => n.id === problem.goal)) return invalid("Choose a goal state first.");
  if (problem.goal === nodeId)
    return invalid("The goal's h can't be set by moving it: every h value depends on where the goal is.");
  const ref = problem.heuristic;
  if (ref.kind === "builtin" && ref.id === "manual")
    return invalid("Manual h values don't depend on positions: type the value in the h table instead.");
  if (ref.kind === "builtin" && ref.id === "zero") return invalid("The zero heuristic is 0 everywhere.");
  if (!Number.isFinite(target) || target < 0) return invalid("h must be a number ≥ 0.");
  const resolved = resolveHeuristic(ref);
  if (!resolved.ok) return invalid(resolved.error);

  const unit = graph.pxPerUnit;
  const index = graph.nodes.indexOf(node);
  let evaluations = 0;
  let lastError = "";
  /** h of the state when placed at (x, y); null where the heuristic fails. */
  const hAt = (x: number, y: number): number | null => {
    evaluations++;
    const moved = { ...node, x, y };
    const nodes = graph.nodes.slice();
    nodes[index] = moved;
    const ctx = lazyHeuristicContext({ ...graph, nodes }, problem)!;
    const r = evaluateNumber(() => resolved.heuristic.h(moved, ctx));
    if (r.ok) return r.value;
    lastError = r.error;
    return null;
  };
  const stats = (): HStats => ({ ms: performance.now() - start, evaluations });

  const h0 = hAt(node.x, node.y);
  if (h0 === null) return invalid(`The heuristic fails for ${node.name}: ${lastError}`);
  const tol = 1e-7 * Math.max(1, Math.abs(target));
  if (Math.abs(h0 - target) <= tol) return invalid(`h(${node.name}) is already ${round(target)}.`);

  const moves = hMoves(graph, nodeId);
  const selected =
    choice.kind === "any"
      ? moves
      : choice.kind === "free"
        ? moves.filter((m) => m.kind === "free")
        : moves.filter((m) => m.kept?.edgeIds.includes(choice.edgeId));
  if (!selected.length) return invalid("That edge doesn't belong to this state.");

  const xs = graph.nodes.map((n) => n.x);
  const ys = graph.nodes.map((n) => n.y);
  const reach = 50 * Math.max(unit, Math.hypot(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)));
  const roots: { move: HMove; x: number; y: number }[] = [];
  const extremes: { move: HMove; x: number; y: number; h: number }[] = [];
  for (const move of selected) {
    let search: Search;
    if (move.kind === "keep") {
      const pivot = graph.nodes.find((n) => n.id === move.pivot!.id)!;
      const r = Math.hypot(node.x - pivot.x, node.y - pivot.y);
      if (r < 1e-9) continue; // the state sits on its neighbour: no circle to move along
      const theta0 = Math.atan2(node.y - pivot.y, node.x - pivot.x);
      search = searchCircle(hAt, pivot.x, pivot.y, r, theta0, h0, target, tol);
    } else {
      search = searchRay(hAt, node.x, node.y, h0, target, tol, unit, reach);
    }
    roots.push(...search.roots.map((p) => ({ move, ...p })));
    extremes.push({ move, ...search.min }, { move, ...search.max });
  }
  if (!extremes.length) return invalid(`${node.name} sits on top of its neighbour, so it can't rotate about it.`);

  const base = computeHeuristicTable(graph, problem, evaluateGraph(graph));
  const protectedSet = new Set(protectedEdges);
  const make = (m: { move: HMove; x: number; y: number }) => proposalAt(graph, problem, base, node, m.move, m.x, m.y);

  if (!roots.length) {
    const min = Math.min(...extremes.map((e) => e.h));
    const max = Math.max(...extremes.map((e) => e.h));
    if (max - min <= 1e-12 * Math.max(1, Math.abs(h0))) return { ok: false, reason: "constant", value: h0, stats: stats() };
    const best = extremes.reduce((a, b) => {
      const da = Math.abs(a.h - target);
      const db = Math.abs(b.h - target);
      if (Math.abs(da - db) > tol) return da < db ? a : b;
      return Math.hypot(a.x - node.x, a.y - node.y) <= Math.hypot(b.x - node.x, b.y - node.y) ? a : b;
    });
    const moved = Math.hypot(best.x - node.x, best.y - node.y) > 1e-9;
    return { ok: false, reason: "range", min, max, closest: moved ? make(best) : null, stats: stats() };
  }

  const seen = new Set<string>();
  const proposals = roots
    .filter((r) => {
      const key = `${r.x.toFixed(6)},${r.y.toFixed(6)}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .map(make);
  const protectedChanges = (p: HProposal) => p.changed.filter((c) => c.edgeIds.some((id) => protectedSet.has(id))).length;
  proposals.sort(
    (a, b) => protectedChanges(a) - protectedChanges(b) || a.changed.length - b.changed.length || a.distance - b.distance,
  );
  return { ok: true, proposals: proposals.slice(0, MAX_PROPOSALS), stats: stats() };
}

interface Sample {
  x: number;
  y: number;
  h: number;
}

interface Search {
  roots: { x: number; y: number }[];
  /** Lowest and highest h found along the way (for out-of-reach reports). */
  min: Sample;
  max: Sample;
}

/** Roots of h(θ) = target on the circle around (cx, cy), starting at the current angle θ0. */
function searchCircle(
  hAt: (x: number, y: number) => number | null,
  cx: number,
  cy: number,
  r: number,
  theta0: number,
  h0: number,
  target: number,
  tol: number,
): Search {
  const point = (t: number) => ({ x: cx + r * Math.cos(t), y: cy + r * Math.sin(t) });
  const hOf = (t: number) => {
    const p = point(t);
    return hAt(p.x, p.y);
  };
  const f = (t: number) => {
    const h = hOf(t);
    return h === null ? null : h - target;
  };
  const step = (2 * Math.PI) / SAMPLES;
  const values: (number | null)[] = [h0];
  for (let k = 1; k < SAMPLES; k++) values.push(hOf(theta0 + k * step));
  values.push(h0); // back at the start

  const roots: number[] = [];
  let lo = { t: theta0, h: h0 };
  let hi = { t: theta0, h: h0 };
  for (let k = 0; k < SAMPLES; k++) {
    const a = values[k];
    const b = values[k + 1];
    const t = theta0 + k * step;
    if (a !== null && a < lo.h) lo = { t, h: a };
    if (a !== null && a > hi.h) hi = { t, h: a };
    if (a === null || b === null) continue;
    if (a === target) roots.push(t);
    else if ((a - target) * (b - target) < 0) {
      const root = bisect(f, t, t + step, a - target, tol);
      if (root !== null) roots.push(root);
    }
  }
  // Refine the extremes, and count a tangent touch (target = min or max) as a root.
  const refine = (e: { t: number; h: number }, sign: 1 | -1) => {
    const better = goldenSection(hOf, e.t - step, e.t + step, sign);
    return better && sign * better.h > sign * e.h ? better : e;
  };
  lo = refine(lo, -1);
  hi = refine(hi, 1);
  if (!roots.length)
    for (const e of [lo, hi]) if (Math.abs(e.h - target) <= tol && e.t !== theta0) roots.push(e.t);
  return {
    roots: roots.map(point),
    min: { ...point(lo.t), h: lo.h },
    max: { ...point(hi.t), h: hi.h },
  };
}

/**
 * Free move: go straight in the direction in which h changes fastest (a numerical gradient),
 * stepping further each time until h passes the target, then bisect.
 */
function searchRay(
  hAt: (x: number, y: number) => number | null,
  x0: number,
  y0: number,
  h0: number,
  target: number,
  tol: number,
  unit: number,
  reach: number,
): Search {
  const here: Sample = { x: x0, y: y0, h: h0 };
  let gx = 0;
  let gy = 0;
  for (const d of [1e-3 * unit, 1e-1 * unit]) {
    const [px, mx, py, my] = [hAt(x0 + d, y0), hAt(x0 - d, y0), hAt(x0, y0 + d), hAt(x0, y0 - d)];
    if (px === null || mx === null || py === null || my === null) continue;
    gx = (px - mx) / (2 * d);
    gy = (py - my) / (2 * d);
    if (Math.hypot(gx, gy) > 1e-12) break;
  }
  const norm = Math.hypot(gx, gy);
  if (!(norm > 1e-12)) return { roots: [], min: here, max: here };
  const sign = Math.sign(target - h0);
  const dx = (sign * gx) / norm;
  const dy = (sign * gy) / norm;
  const point = (s: number) => ({ x: x0 + s * dx, y: y0 + s * dy });
  const f = (s: number) => {
    const p = point(s);
    const h = hAt(p.x, p.y);
    return h === null ? null : h - target;
  };

  let min = here;
  let max = here;
  let prev = 0;
  let fPrev = h0 - target;
  for (let s = Math.max(1e-3 * unit, Math.min(Math.abs(target - h0) / norm, reach) / 4); s <= reach; s *= 1.6) {
    const fs = f(s);
    if (fs === null) continue;
    const sample = { ...point(s), h: fs + target };
    if (sample.h < min.h) min = sample;
    if (sample.h > max.h) max = sample;
    if (fs === 0) return { roots: [point(s)], min, max };
    if (fs * fPrev < 0) {
      const root = bisect(f, prev, s, fPrev, tol);
      return { roots: root === null ? [] : [point(root)], min, max };
    }
    prev = s;
    fPrev = fs;
  }
  return { roots: [], min, max };
}

/** Bisection on [lo, hi] where f(lo) = fLo has the opposite sign of f(hi). Null unless |f| ≤ tol. */
function bisect(f: (t: number) => number | null, lo: number, hi: number, fLo: number, tol: number): number | null {
  for (let i = 0; i < 200 && hi - lo > 1e-13 * Math.max(1, Math.abs(lo)); i++) {
    const mid = (lo + hi) / 2;
    const fm = f(mid);
    if (fm === null) return null;
    if (fm === 0) return mid;
    if (Math.sign(fm) === Math.sign(fLo)) {
      lo = mid;
      fLo = fm;
    } else {
      hi = mid;
    }
  }
  const t = (lo + hi) / 2;
  const ft = f(t);
  return ft !== null && Math.abs(ft) <= tol ? t : null;
}

/** Golden-section search for the extreme (max for sign 1, min for −1) of g on [a, b]. */
function goldenSection(g: (t: number) => number | null, a: number, b: number, sign: 1 | -1): { t: number; h: number } | null {
  const phi = (Math.sqrt(5) - 1) / 2;
  let c = b - phi * (b - a);
  let d = a + phi * (b - a);
  let fc = g(c);
  let fd = g(d);
  for (let i = 0; i < 60; i++) {
    if (fc === null || fd === null) return null;
    if (sign * fc > sign * fd) {
      b = d;
      d = c;
      fd = fc;
      c = b - phi * (b - a);
      fc = g(c);
    } else {
      a = c;
      c = d;
      fc = fd;
      d = a + phi * (b - a);
      fd = g(d);
    }
  }
  const t = (a + b) / 2;
  const h = g(t);
  return h === null ? null : { t, h };
}

function proposalAt(
  graph: StateSpaceGraph,
  problem: Problem,
  base: HeuristicTable,
  node: { id: string; name: string; x: number; y: number },
  move: HMove,
  x: number,
  y: number,
): HProposal {
  const unit = graph.pxPerUnit;
  const moved = { ...graph, nodes: graph.nodes.map((n) => (n.id === node.id ? { ...n, x, y } : n)) };
  const table = computeHeuristicTable(moved, problem, evaluateGraph(moved));

  const s = buildStructure(graph);
  const after = buildStructure(moved);
  const v = s.indexOf.get(node.id)!;
  const changed: ChangedBar[] = [];
  for (const bar of s.incident[v]) {
    const b = s.bars[bar];
    if (move.kept && b.edgeIds.includes(move.kept.edgeIds[0])) continue;
    const before = b.length / unit;
    const now = distance(after.pos, b.u, b.v) / unit;
    if (Math.abs(now - before) > 1e-9)
      changed.push({ edgeIds: b.edgeIds, a: node.name, b: s.names[otherEnd(b, v)], length: before, after: now });
  }

  const hChanges: HProposal["hChanges"] = [];
  for (const n of graph.nodes) {
    if (n.id === node.id) continue;
    const before = base.values[n.id] ?? null;
    const now = table.values[n.id] ?? null;
    const same = before === null || now === null ? before === now : Math.abs(now - before) <= 1e-9 * Math.max(1, Math.abs(before));
    if (!same) hChanges.push({ id: n.id, name: n.name, before, after: now });
  }

  const dist = Math.hypot(x - node.x, y - node.y) / unit;
  let motion = `${node.name} moves ${round(dist)} units`;
  if (move.kind === "keep") {
    const pivot = graph.nodes.find((n) => n.id === move.pivot!.id)!;
    let angle = Math.atan2(y - pivot.y, x - pivot.x) - Math.atan2(node.y - pivot.y, node.x - pivot.x);
    while (angle > Math.PI) angle -= 2 * Math.PI;
    while (angle < -Math.PI) angle += 2 * Math.PI;
    const sense = angle > 0 ? "clockwise" : "counter-clockwise"; // screen y points down
    motion = `${node.name} rotates ${Math.abs((angle * 180) / Math.PI).toFixed(1)}° ${sense} about ${pivot.name}`;
  }

  return {
    move,
    position: { x, y },
    h: table.values[node.id] ?? NaN,
    distance: dist,
    motion,
    changed,
    hChanges,
  };
}

function invalid(message: string): HResult {
  return { ok: false, reason: "invalid", message };
}

function round(x: number): number {
  return Number(x.toFixed(2));
}
