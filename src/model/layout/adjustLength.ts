import type { StateSpaceGraph } from "../schema";
import { describeMotions } from "./describe";
import { genericPositions, realizeFewestMoved, realizeSmooth, type Realization, type RealizeContext } from "./movers";
import { findReleaseSets } from "./release";
import { barDistances, blocksOf, buildStructure, componentOf, distance, hopDistances, type Structure } from "./structure";

/** Which end of the edited edge must stay in place. */
export type KeepFixed = "auto" | "from" | "to";

export interface AdjustOptions {
  /** Edge ids whose lengths must not change. */
  locked?: Iterable<string>;
  keepFixed?: KeepFixed;
  /** Time budget in ms; the search returns the best result found when it runs out. */
  budgetMs?: number;
}

/** A pair of states joined by one edge, or by two opposite one-way edges. Lengths in units. */
export interface BarInfo {
  edgeIds: string[];
  a: string;
  b: string;
  length: number;
}

export interface ChangedBar extends BarInfo {
  /** New length in units (`length` is the current one). */
  after: number;
}

export interface Proposal {
  kind: "fewest-moved" | "least-movement";
  /** New positions (px) of the states that move. */
  positions: Record<string, { x: number; y: number }>;
  /** Moved states with the distance moved (units). */
  moved: { id: string; name: string; distance: number }[];
  /** Other edges whose length changes. */
  changed: ChangedBar[];
  /** Readable motions, e.g. "A rotates 7.9° clockwise about C". */
  motions: string[];
}

export interface AdjustStats {
  ms: number;
  rigidityTests: number;
}

export type AdjustResult =
  | {
      ok: true;
      /** Best first: fewest changed edges, then fewest moved states, then least movement. */
      proposals: Proposal[];
      /** True when no solution with fewer changed edges exists (generic rigidity, within the budget). */
      minimal: boolean;
      /** Set when the target is out of reach with fewer changes: the closest length those allow. */
      reachable?: { length: number; changes: number };
      stats: AdjustStats;
    }
  | { ok: false; reason: "locked"; blocking: BarInfo[]; stats: AdjustStats }
  | { ok: false; reason: "range"; reachable: number; changes: number; stats: AdjustStats }
  | { ok: false; reason: "invalid"; message: string };

const MOVE_EPS = 1e-6; // px: smaller displacements are solver noise
const CHANGE_EPS = 1e-4; // px

/**
 * Edges whose length could change when `edgeId` changes: the other edges of its biconnected
 * block, nearest first. Everything outside the block is attached through a single state and can
 * always follow along without changing length.
 */
export function potentiallyAffected(graph: StateSpaceGraph, edgeId: string): BarInfo[] {
  const s = buildStructure(graph);
  const target = s.barOfEdge.get(edgeId);
  if (target === undefined) return [];
  const block = blocksOf(s);
  const dist = barDistances(s, target);
  return s.bars
    .map((_, i) => i)
    .filter((i) => i !== target && block[i] === block[target])
    .sort((x, y) => dist[x] - dist[y])
    .map((i) => barInfo(s, i, graph.pxPerUnit));
}

interface Attempt {
  F: number[];
  r: Realization;
}

/**
 * Give an edge a new length, moving states so that as few other edges as possible change length,
 * locked edges keep theirs, and as few states as possible move.
 *
 * 1. Rigidity (pebble game): find the smallest sets of edges in the edge's block that must be
 *    allowed to change (`findReleaseSets`).
 * 2. Motion: for each set, grow the fewest moving states from either end and solve for their
 *    positions by continuation (`realizeFewestMoved`).
 * 3. If the length is out of reach (e.g. past a fully stretched chain), release the edges that
 *    resist most, one at a time.
 * 4. Rank the solutions and add a least-total-movement alternative.
 */
export function adjustEdgeLength(
  graph: StateSpaceGraph,
  edgeId: string,
  targetUnits: number,
  options: AdjustOptions = {},
): AdjustResult {
  const start = performance.now();
  const budget = options.budgetMs ?? 250;
  const s = buildStructure(graph);
  const target = s.barOfEdge.get(edgeId);
  const edge = graph.edges.find((e) => e.id === edgeId);
  if (target === undefined || !edge) return { ok: false, reason: "invalid", message: "Unknown edge." };
  if (!Number.isFinite(targetUnits) || targetUnits <= 0)
    return { ok: false, reason: "invalid", message: "The length must be a positive number." };
  const unit = graph.pxPerUnit;
  const targetPx = targetUnits * unit;
  const tb = s.bars[target];
  if (Math.abs(targetPx - tb.length) < CHANGE_EPS)
    return { ok: false, reason: "invalid", message: "The edge already has this length." };

  const from = s.indexOf.get(edge.from)!;
  const to = s.indexOf.get(edge.to)!;
  const keepFixed = options.keepFixed ?? "auto";
  const fixed = new Set(keepFixed === "from" ? [from] : keepFixed === "to" ? [to] : []);
  const seeds = keepFixed === "from" ? [to] : keepFixed === "to" ? [from] : [from, to];
  const locked = new Set<number>();
  for (const id of options.locked ?? []) {
    const bar = s.barOfEdge.get(id);
    if (bar !== undefined && bar !== target) locked.add(bar);
  }

  // 1. Fewest edges that must change.
  const block = blocksOf(s);
  const blockBars = s.bars.map((_, i) => i).filter((i) => block[i] === block[target]);
  const release = findReleaseSets(s, target, blockBars, locked, {
    deadline: start + budget * 0.4,
    distance: barDistances(s, target),
  });
  const stats = (): AdjustStats => ({ ms: performance.now() - start, rigidityTests: release.tests });
  if (!release.sets.length)
    return {
      ok: false,
      reason: "locked",
      blocking: (release.blocking ?? []).filter((bar) => locked.has(bar)).map((bar) => barInfo(s, bar, unit)),
      stats: stats(),
    };

  // 2. Fewest moving states for each candidate set.
  const hop = hopDistances(s, [tb.u, tb.v]);
  const generic = genericPositions(s);
  const deadline = Math.max(start + budget, performance.now() + budget / 2);
  const hardDeadline = deadline + 2 * budget;
  const context = (F: number[], until: number): RealizeContext => {
    const kept = new Uint8Array(s.bars.length).fill(1);
    kept[target] = 0;
    for (const bar of F) kept[bar] = 0;
    return { s, kept, target, targetPx, generic, deadline: until };
  };
  const realize = (F: number[], until: number): Attempt[] => {
    const ctx = context(F, until);
    return seeds.flatMap((seed) => {
      const r = realizeFewestMoved(ctx, seed, fixed, hop);
      return r ? [{ F, r }] : [];
    });
  };

  const attempts: Attempt[] = [];
  for (const F of release.sets) {
    attempts.push(...realize(F, deadline));
    if (performance.now() > deadline) break;
  }
  let solved = attempts.filter((a) => a.r.ok);
  let minimal = release.minimal;
  let reachable: { length: number; changes: number } | undefined;

  // 3. Out of reach: release the most resisting edges one at a time.
  if (!solved.length) {
    const progress = (a: Attempt) => Math.abs(a.r.reached - tb.length);
    let current = attempts.reduce<Attempt | null>((best, a) => (!best || progress(a) > progress(best) ? a : best), null);
    if (!current) return { ok: false, reason: "range", reachable: tb.length / unit, changes: 0, stats: stats() };
    reachable = { length: current.r.reached / unit, changes: current.F.length };
    const original = current.F;
    for (let round = 0; round < 6 && !solved.length && performance.now() < hardDeadline; round++) {
      const used = current.F;
      const resisting = [...(current.r.resistance ?? [])]
        .filter(([bar]) => block[bar] === block[target] && !locked.has(bar) && !used.includes(bar))
        .sort((x, y) => y[1] - x[1])
        .slice(0, 2)
        .map(([bar]) => bar);
      let next: Attempt | null = null;
      for (const bar of resisting) {
        const tries = realize([...used, bar], hardDeadline);
        solved = tries.filter((a) => a.r.ok);
        if (solved.length) break;
        for (const a of tries) if (!next || progress(a) > progress(next)) next = a;
      }
      if (solved.length || !next || progress(next) <= progress(current)) break;
      current = next;
    }
    if (!solved.length)
      return { ok: false, reason: "range", reachable: reachable.length, changes: reachable.changes, stats: stats() };
    // Drop extra releases that turn out to be unnecessary.
    let F = solved[0].F;
    for (const bar of F.filter((b) => !original.includes(b)).reverse()) {
      const without = F.filter((b) => b !== bar);
      const tries = realize(without, hardDeadline).filter((a) => a.r.ok);
      if (tries.length) {
        F = without;
        solved = tries;
      }
    }
    minimal = false;
  }

  // 4. Rank, and offer the least-total-movement alternative too.
  const ranked = solved
    .map((a) => ({ F: a.F, p: toProposal(s, a.r.pos, target, unit, "fewest-moved") }))
    .sort((x, y) => compareProposals(x.p, y.p));
  const proposals: Proposal[] = [];
  const seen = new Set<string>();
  for (const { p } of ranked) {
    const key = proposalKey(p);
    if (seen.has(key)) continue;
    seen.add(key);
    proposals.push(p);
    if (proposals.length === 3) break;
  }
  const free = componentOf(s, tb.u).filter((v) => !fixed.has(v));
  if (free.length <= 150 && performance.now() < hardDeadline) {
    const smooth = realizeSmooth(context(ranked[0].F, performance.now() + budget), free);
    if (smooth.ok) {
      const p = toProposal(s, smooth.pos, target, unit, "least-movement");
      if (!seen.has(proposalKey(p))) proposals.push(p);
    }
  }
  return { ok: true, proposals, minimal, reachable, stats: stats() };
}

function barInfo(s: Structure, bar: number, unit: number): BarInfo {
  const b = s.bars[bar];
  return { edgeIds: b.edgeIds, a: s.names[b.u], b: s.names[b.v], length: b.length / unit };
}

function toProposal(s: Structure, result: Float64Array, target: number, unit: number, kind: Proposal["kind"]): Proposal {
  const pos = Float64Array.from(result);
  const positions: Proposal["positions"] = {};
  const moved: Proposal["moved"] = [];
  const movedIndex: number[] = [];
  for (let v = 0; v < s.ids.length; v++) {
    const d = Math.hypot(pos[2 * v] - s.pos[2 * v], pos[2 * v + 1] - s.pos[2 * v + 1]);
    if (d > MOVE_EPS) {
      positions[s.ids[v]] = { x: pos[2 * v], y: pos[2 * v + 1] };
      moved.push({ id: s.ids[v], name: s.names[v], distance: d / unit });
      movedIndex.push(v);
    } else {
      pos[2 * v] = s.pos[2 * v];
      pos[2 * v + 1] = s.pos[2 * v + 1];
    }
  }
  const changed: ChangedBar[] = [];
  s.bars.forEach((bar, i) => {
    if (i === target) return;
    const after = distance(pos, bar.u, bar.v);
    if (Math.abs(after - bar.length) > CHANGE_EPS) changed.push({ ...barInfo(s, i, unit), after: after / unit });
  });
  return { kind, positions, moved, changed, motions: describeMotions(s, pos, movedIndex, unit) };
}

function compareProposals(x: Proposal, y: Proposal): number {
  const movement = (p: Proposal) => p.moved.reduce((sum, m) => sum + m.distance * m.distance, 0);
  return x.changed.length - y.changed.length || x.moved.length - y.moved.length || movement(x) - movement(y);
}

function proposalKey(p: Proposal): string {
  return Object.entries(p.positions)
    .map(([id, { x, y }]) => `${id}:${x.toFixed(3)},${y.toFixed(3)}`)
    .sort()
    .join(";");
}
