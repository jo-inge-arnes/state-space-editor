"use client";

import { useCallback, useState } from "react";
import type { HeuristicTable } from "@/model/heuristics/registry";
import type { StateSpaceGraph } from "@/model/schema";

/** Helpers shared by the “Change length” and “Change h(n)” tools. */

export type Positions = Record<string, { x: number; y: number }>;

/** Remembered for this session only, so later changes don't silently undo earlier ones. */
export interface SessionMarks {
  /** Edges whose length was set with the length tool. */
  lengthsSet: ReadonlySet<string>;
  /** States whose h was set with the h tool. */
  hSet: ReadonlySet<string>;
  markLengths: (edgeIds: string[], on: boolean) => void;
  markH: (nodeId: string, on: boolean) => void;
}

export function useSessionMarks(): SessionMarks {
  const [lengthsSet, setLengthsSet] = useState<ReadonlySet<string>>(new Set());
  const [hSet, setHSet] = useState<ReadonlySet<string>>(new Set());
  const markLengths = useCallback(
    (ids: string[], on: boolean) => setLengthsSet((s) => toggled(s, ids, on)),
    [],
  );
  const markH = useCallback((id: string, on: boolean) => setHSet((s) => toggled(s, [id], on)), []);
  return { lengthsSet, hSet, markLengths, markH };
}

function toggled(set: ReadonlySet<string>, ids: string[], on: boolean): ReadonlySet<string> {
  const next = new Set(set);
  for (const id of ids) {
    if (on) next.add(id);
    else next.delete(id);
  }
  return next;
}

/** True if the given nodes are exactly at these positions (so an Undo still applies). */
export function positionsMatch(graph: StateSpaceGraph, positions: Positions): boolean {
  return Object.entries(positions).every(([id, p]) => {
    const n = graph.nodes.find((x) => x.id === id);
    return n?.x === p.x && n?.y === p.y;
  });
}

/** Current positions of the nodes that `positions` would move. */
export function currentPositions(graph: StateSpaceGraph, positions: Positions): Positions {
  const out: Positions = {};
  for (const id of Object.keys(positions)) {
    const n = graph.nodes.find((x) => x.id === id);
    if (n) out[id] = { x: n.x, y: n.y };
  }
  return out;
}

export function nameOf(graph: StateSpaceGraph, id: string): string {
  return graph.nodes.find((n) => n.id === id)?.name ?? id;
}

/** Ids of all edges between the two states (an edge and its opposite one-way edge). */
export function samePair(graph: StateSpaceGraph, a: string, b: string): string[] {
  return graph.edges.filter((e) => (e.from === a && e.to === b) || (e.from === b && e.to === a)).map((e) => e.id);
}

export function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}

/** Everything a length adjustment depends on: scale, positions and which states each edge joins. */
export function geometryKey(graph: StateSpaceGraph): string {
  return [
    graph.pxPerUnit,
    graph.nodes.map((n) => `${n.id}:${n.x}:${n.y}`).join(","),
    graph.edges.map((e) => `${e.id}:${e.from}:${e.to}`).join(","),
  ].join("|");
}

export interface HChange {
  id: string;
  name: string;
  before: number | null;
  after: number | null;
}

/** States whose h differs between two heuristic tables (e.g. now and in a previewed layout). */
export function hTableChanges(
  graph: StateSpaceGraph,
  before: HeuristicTable | null,
  after: HeuristicTable | null,
  skip?: string,
): HChange[] {
  if (!before || !after || before.error || after.error || before === after) return [];
  return graph.nodes.flatMap((n) => {
    if (n.id === skip) return [];
    const b = before.values[n.id] ?? null;
    const a = after.values[n.id] ?? null;
    const same = b === null || a === null ? a === b : Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(b));
    return same ? [] : [{ id: n.id, name: n.name, before: b, after: a }];
  });
}
