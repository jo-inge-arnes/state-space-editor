"use client";

import { useCallback, useMemo, useState, type Dispatch, type ReactNode } from "react";
import type { EvaluatedGraph } from "@/model/actions";
import {
  adjustEdgeLength,
  potentiallyAffected,
  type AdjustResult,
  type BarInfo,
  type KeepFixed,
  type Proposal,
} from "@/model/layout/adjustLength";
import type { StateSpaceGraph } from "@/model/schema";
import type { EditorAction, EditorState } from "@/state/editorReducer";
import type { CanvasOverlay } from "./Canvas";
import { formatNumber } from "./format";
import NumberInput from "./NumberInput";
import styles from "./Editor.module.css";

type Positions = Record<string, { x: number; y: number }>;

interface LengthEdit {
  edgeId: string;
  /** Target length in units. */
  target: number;
  locked: ReadonlySet<string>;
  keepFixed: KeepFixed;
  phase: "locks" | "result" | "applied";
  result: AdjustResult | null;
  /** Geometry the result was computed for; the result is stale once the graph changes. */
  resultKey: string | null;
  /** Shown alternative. */
  alt: number;
  /** After Apply: positions before and after, for Undo. */
  undo?: { before: Positions; after: Positions; wasSet: boolean };
}

export interface LengthTool {
  edit: LengthEdit | null;
  /** Edges whose length could change, nearest first (opposite one-way edges grouped). */
  affected: BarInfo[];
  /** Edges whose length was set with this tool in this session (pre-locked next time). */
  lengthsSet: ReadonlySet<string>;
  /** The proposal being previewed, if the result is current. */
  proposal: Proposal | null;
  stale: boolean;
  canUndo: boolean;
  overlay: CanvasOverlay | undefined;
  /** Short title for the phone sheet bar. */
  title: string | null;
  start: (edgeId: string, target: number) => void;
  setTarget: (target: number) => void;
  toggleLock: (edgeId: string) => void;
  setAllLocks: (locked: boolean) => void;
  setKeepFixed: (keepFixed: KeepFixed) => void;
  compute: (target?: number) => void;
  setAlt: (alt: number) => void;
  back: () => void;
  apply: () => void;
  undo: () => void;
  close: () => void;
}

/** State and actions of the “Change length” tool, shared by the side panel and the canvas. */
export function useLengthTool(state: EditorState, dispatch: Dispatch<EditorAction>): LengthTool {
  const { graph } = state;
  const [edit, setEdit] = useState<LengthEdit | null>(null);
  // Remembered for this session only: the last lock choices, and edges whose length was set here.
  const [sessionLocks, setSessionLocks] = useState<ReadonlySet<string>>(new Set());
  const [lengthsSet, setLengthsSet] = useState<ReadonlySet<string>>(new Set());

  const key = useMemo(() => geometryKey(graph), [graph]);
  const edgeId = edit?.edgeId ?? null;
  const edge = edgeId ? graph.edges.find((e) => e.id === edgeId) : undefined;
  const active = edit && edge ? edit : null;
  const affected = useMemo(() => (edgeId && edge ? potentiallyAffected(graph, edgeId) : []), [graph, edgeId, edge]);
  const pairIds = useMemo(() => (edge ? samePair(graph, edge.from, edge.to) : []), [graph, edge]);

  const stale = !!active?.result && active.resultKey !== key;
  const result = active?.phase === "result" && !stale ? active.result : null;
  const proposal = result?.ok ? (result.proposals[active!.alt] ?? null) : null;
  const canUndo =
    active?.phase === "applied" &&
    !!active.undo &&
    Object.entries(active.undo.after).every(([id, p]) => {
      const n = graph.nodes.find((x) => x.id === id);
      return n?.x === p.x && n?.y === p.y;
    });

  const run = useCallback(
    (e: LengthEdit, target = e.target): LengthEdit => {
      const res = adjustEdgeLength(graph, e.edgeId, target, { locked: e.locked, keepFixed: e.keepFixed });
      return { ...e, target, phase: "result", result: res, resultKey: key, alt: 0, undo: undefined };
    },
    [graph, key],
  );

  const start = useCallback(
    (id: string, target: number) => {
      const bars = potentiallyAffected(graph, id);
      const pre = new Set(
        bars.flatMap((b) => (b.edgeIds.some((x) => sessionLocks.has(x) || lengthsSet.has(x)) ? b.edgeIds : [])),
      );
      const e: LengthEdit = { edgeId: id, target, locked: pre, keepFixed: "auto", phase: "locks", result: null, resultKey: null, alt: 0 };
      // Nothing to lock (a bridge): go straight to the result.
      setEdit(bars.length ? e : run(e));
    },
    [graph, sessionLocks, lengthsSet, run],
  );

  const toggleLock = useCallback(
    (id: string) => {
      const bar = affected.find((b) => b.edgeIds.includes(id));
      if (!bar) return;
      setEdit((e) => {
        if (!e) return e;
        const locked = new Set(e.locked);
        const on = !bar.edgeIds.some((x) => locked.has(x));
        for (const x of bar.edgeIds) {
          if (on) locked.add(x);
          else locked.delete(x);
        }
        return { ...e, locked, phase: "locks", result: null };
      });
    },
    [affected],
  );

  const close = useCallback(() => setEdit(null), []);

  const overlay = useMemo<CanvasOverlay | undefined>(() => {
    if (!active || active.phase === "applied") return undefined;
    return {
      phase: proposal ? "preview" : "locks",
      targetEdgeIds: new Set(pairIds),
      affected: new Set(affected.flatMap((b) => b.edgeIds)),
      locked: active.locked,
      changed: proposal ? new Set(proposal.changed.flatMap((c) => c.edgeIds)) : undefined,
      ghosts: proposal
        ? Object.keys(proposal.positions).flatMap((id) => {
            const n = graph.nodes.find((x) => x.id === id);
            return n ? [{ id, x: n.x, y: n.y }] : [];
          })
        : undefined,
      onToggleLock: toggleLock,
    };
  }, [active, proposal, pairIds, affected, graph, toggleLock]);

  return {
    edit: active,
    affected,
    lengthsSet,
    proposal,
    stale,
    canUndo,
    overlay,
    title: active && edge && active.phase !== "applied" ? `Length ${nameOf(graph, edge.from)} – ${nameOf(graph, edge.to)}` : null,
    start,
    toggleLock,
    setTarget: (target) => active && setEdit(active.phase === "result" ? run(active, target) : { ...active, target }),
    setAllLocks: (on) =>
      active && setEdit({ ...active, locked: new Set(on ? affected.flatMap((b) => b.edgeIds) : []), phase: "locks", result: null }),
    setKeepFixed: (keepFixed) => active && setEdit({ ...active, keepFixed, phase: "locks", result: null }),
    compute: (target) => {
      if (!active) return;
      setSessionLocks(new Set(active.locked));
      setEdit(run(active, target));
    },
    setAlt: (alt) => active && setEdit({ ...active, alt }),
    back: () => active && setEdit({ ...active, phase: "locks", result: null }),
    apply: () => {
      if (!active || !proposal) return;
      const before: Positions = {};
      for (const id of Object.keys(proposal.positions)) {
        const n = graph.nodes.find((x) => x.id === id)!;
        before[id] = { x: n.x, y: n.y };
      }
      dispatch({ type: "setPositions", positions: proposal.positions });
      const wasSet = pairIds.every((x) => lengthsSet.has(x));
      setLengthsSet(new Set([...lengthsSet, ...pairIds]));
      setSessionLocks(new Set(active.locked));
      setEdit({ ...active, phase: "applied", result: null, undo: { before, after: proposal.positions, wasSet } });
    },
    undo: () => {
      if (!active?.undo || !canUndo) return;
      dispatch({ type: "setPositions", positions: active.undo.before });
      if (!active.undo.wasSet) setLengthsSet(new Set([...lengthsSet].filter((x) => !pairIds.includes(x))));
      setEdit({ ...active, phase: "locks", result: null, undo: undefined });
    },
    close,
  };
}

interface Props {
  tool: LengthTool;
  state: EditorState;
  evaluated: EvaluatedGraph;
}

/** The “Change length” panel: choose locked edges, compute, preview alternatives, apply or undo. */
export default function LengthPanel({ tool, state, evaluated }: Props) {
  const { edit } = tool;
  if (!edit) return null;
  const edge = state.graph.edges.find((e) => e.id === edit.edgeId)!;
  const from = evaluated.nodeById.get(edge.from)!;
  const to = evaluated.nodeById.get(edge.to)!;
  const current = evaluated.edges[edge.id]?.length ?? 0;
  const pair = (
    <>
      <strong>{from.name}</strong> {edge.directed ? "→" : "↔"} <strong>{to.name}</strong>
    </>
  );

  if (edit.phase === "applied")
    return (
      <div className={styles.sectionBody}>
        <p className={styles.okText}>
          {pair} is now {formatNumber(current)} units.
        </p>
        <div className={styles.row}>
          {tool.canUndo && <button onClick={tool.undo}>Undo</button>}
          <button onClick={tool.close}>Done</button>
        </div>
      </div>
    );

  const result = edit.phase === "result" && !tool.stale ? edit.result : null;
  const isLocked = (bar: BarInfo) => bar.edgeIds.some((id) => edit.locked.has(id));

  return (
    <div className={styles.sectionBody}>
      <div className={styles.row}>
        <span>
          {pair}: {formatNumber(current)} →
        </span>
        <NumberInput
          value={edit.target}
          min={0.0001}
          step={0.1}
          aria-label="New length"
          onCommit={(v) => v > 0 && tool.setTarget(v)}
        />
        <span>units</span>
      </div>

      {!result && (
        <>
          {tool.affected.length === 0 ? (
            <p className={styles.muted}>
              No other edge can change: this edge is the only link between two parts of the graph.
            </p>
          ) : (
            <>
              <p className={styles.muted}>Which edges must keep their length? Tick them here or click them on the canvas.</p>
              <ul className={styles.lockList}>
                {tool.affected.map((bar) => (
                  <li key={bar.edgeIds[0]}>
                    <label className={styles.toggle}>
                      <input type="checkbox" checked={isLocked(bar)} onChange={() => tool.toggleLock(bar.edgeIds[0])} />
                      <span>
                        {bar.a} – {bar.b}
                      </span>
                      <span className={styles.lockLength}>{formatNumber(bar.length)}</span>
                      {bar.edgeIds.some((id) => tool.lengthsSet.has(id)) && <span className={styles.badge}>set earlier</span>}
                    </label>
                  </li>
                ))}
              </ul>
              <div className={styles.row}>
                <button onClick={() => tool.setAllLocks(true)}>Lock all</button>
                <button onClick={() => tool.setAllLocks(false)}>Unlock all</button>
              </div>
              <p className={styles.muted}>
                Edges not listed never change length: they attach through a single state and move along.
              </p>
            </>
          )}
          <div className={styles.row} role="radiogroup" aria-label="Keep fixed">
            <span className={styles.muted}>Keep in place:</span>
            {(
              [
                ["auto", "either end"],
                ["from", from.name],
                ["to", to.name],
              ] as const
            ).map(([value, label]) => (
              <label key={value} className={styles.toggle}>
                <input
                  type="radio"
                  name="keep-fixed"
                  checked={edit.keepFixed === value}
                  onChange={() => tool.setKeepFixed(value)}
                />
                {label}
              </label>
            ))}
          </div>
          {tool.stale && <p className={styles.warnText}>The graph changed since the last result. Compute again.</p>}
          <div className={styles.row}>
            <button className="primary" onClick={() => tool.compute()}>
              Compute
            </button>
            <button onClick={tool.close}>Cancel</button>
          </div>
        </>
      )}

      {result && <ResultView tool={tool} result={result} pair={pair} />}
    </div>
  );
}

function ResultView({ tool, result, pair }: { tool: LengthTool; result: AdjustResult; pair: ReactNode }) {
  const { edit, proposal } = tool;
  const buttons = (
    <div className={styles.row}>
      {proposal && (
        <button className="primary" onClick={tool.apply}>
          Apply
        </button>
      )}
      <button onClick={tool.back}>Back</button>
      <button onClick={tool.close}>Cancel</button>
    </div>
  );

  if (!result.ok) {
    if (result.reason === "invalid") return <p className={styles.error}>{result.message}</p>;
    if (result.reason === "locked")
      return (
        <>
          <p className={styles.error}>
            {pair} can’t change while these locked edges keep their length:{" "}
            {result.blocking.map((b) => `${b.a} – ${b.b}`).join(", ")}. Unlock at least one of them.
          </p>
          {buttons}
        </>
      );
    return (
      <>
        <p className={styles.error}>
          Out of reach with these locks: the closest length is {formatNumber(result.reachable)}
          {result.changes ? ` (with ${plural(result.changes, "other edge")} changing)` : ""}.
        </p>
        <div className={styles.row}>
          <button onClick={() => tool.compute(Number(result.reachable.toFixed(4)))}>
            Use {formatNumber(result.reachable)}
          </button>
        </div>
        {buttons}
      </>
    );
  }

  const n = result.proposals.length;
  const p = proposal!;
  return (
    <>
      <p className={p.changed.length ? styles.warnText : styles.okText}>
        {p.changed.length === 0 ? "No other edge changes." : `${plural(p.changed.length, "other edge")} change${p.changed.length === 1 ? "s" : ""}:`}
      </p>
      {p.changed.length > 0 && (
        <ul className={styles.plainList}>
          {p.changed.map((c) => (
            <li key={c.edgeIds[0]}>
              {c.a} – {c.b}: {formatNumber(c.length)} → {formatNumber(c.after)}
            </li>
          ))}
        </ul>
      )}
      {result.reachable && (
        <div className={styles.row}>
          <span className={styles.muted}>
            Without {result.reachable.changes ? "more " : ""}changes the closest length is{" "}
            {formatNumber(result.reachable.length)}.
          </span>
          <button onClick={() => tool.compute(Number(result.reachable!.length.toFixed(4)))}>
            Use {formatNumber(result.reachable.length)}
          </button>
        </div>
      )}
      {!result.minimal && !result.reachable && (
        <p className={styles.muted}>Fewest changes found within the time limit; there may be a solution with fewer.</p>
      )}
      <p className={styles.muted}>Moves {plural(p.moved.length, "state")}:</p>
      <ul className={styles.plainList}>
        {p.motions.map((m) => (
          <li key={m}>{m}</li>
        ))}
      </ul>
      {n > 1 && (
        <div className={styles.row}>
          <button aria-label="Previous option" disabled={edit!.alt === 0} onClick={() => tool.setAlt(edit!.alt - 1)}>
            ◀
          </button>
          <span>
            Option {edit!.alt + 1} of {n}
            <span className={styles.muted}>
              {" "}
              · {p.kind === "least-movement" ? "least total movement" : "fewest moved states"}
            </span>
          </span>
          <button aria-label="Next option" disabled={edit!.alt === n - 1} onClick={() => tool.setAlt(edit!.alt + 1)}>
            ▶
          </button>
        </div>
      )}
      <p className={styles.muted}>
        Computed in {Math.max(1, Math.round(result.stats.ms))} ms ({result.stats.rigidityTests} rigidity{" "}
        {result.stats.rigidityTests === 1 ? "test" : "tests"}).
      </p>
      {buttons}
    </>
  );
}

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}

function nameOf(graph: StateSpaceGraph, id: string): string {
  return graph.nodes.find((n) => n.id === id)?.name ?? id;
}

/** Ids of all edges between the two states (an edge and its opposite one-way edge). */
function samePair(graph: StateSpaceGraph, a: string, b: string): string[] {
  return graph.edges.filter((e) => (e.from === a && e.to === b) || (e.from === b && e.to === a)).map((e) => e.id);
}

/** Everything a length adjustment depends on: scale, positions and which states each edge joins. */
function geometryKey(graph: StateSpaceGraph): string {
  return [
    graph.pxPerUnit,
    graph.nodes.map((n) => `${n.id}:${n.x}:${n.y}`).join(","),
    graph.edges.map((e) => `${e.id}:${e.from}:${e.to}`).join(","),
  ].join("|");
}
