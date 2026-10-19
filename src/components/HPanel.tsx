"use client";

import { useCallback, useMemo, useState, type Dispatch, type ReactNode } from "react";
import type { EvaluatedGraph } from "@/model/actions";
import { resolveHeuristic, type HeuristicTable } from "@/model/heuristics/registry";
import { adjustH, hMoves, type HChoice, type HMove, type HProposal, type HResult } from "@/model/layout/adjustH";
import type { Problem } from "@/model/schema";
import type { EditorAction, EditorState } from "@/state/editorReducer";
import type { CanvasOverlay } from "./Canvas";
import { formatNumber } from "./format";
import NumberInput from "./NumberInput";
import { AltNav, HChangeList } from "./ToolParts";
import { currentPositions, nameOf, positionsMatch, type Positions, type SessionMarks } from "./tools";
import styles from "./Editor.module.css";

interface HEdit {
  nodeId: string;
  target: number;
  choice: HChoice;
  phase: "choose" | "result" | "applied";
  result: HResult | null;
  /** Graph and heuristic the result was computed for; the result is stale once they change. */
  resultKey: string | null;
  alt: number;
  /** After Apply: what to restore on Undo. */
  undo?: {
    positions?: { before: Positions; after: Positions };
    /** The node's override before and after (null = none). */
    override: { before: number | null; after: number | null };
    wasSet: boolean;
  };
}

export interface HTool {
  edit: HEdit | null;
  /** Ways the state can move: keep one of its edges, or none. */
  moves: HMove[];
  proposal: HProposal | null;
  previewPositions: Positions | undefined;
  stale: boolean;
  canUndo: boolean;
  overlay: CanvasOverlay | undefined;
  title: string | null;
  marks: SessionMarks;
  start: (nodeId: string, target: number) => void;
  setTarget: (target: number) => void;
  choose: (choice: HChoice) => void;
  /** Set the target as an override of the heuristic's value, without moving anything. */
  override: () => void;
  /** Remove the state's override, so the heuristic's own value counts again. */
  clearOverride: () => void;
  compute: (target?: number) => void;
  pickClosest: () => void;
  setAlt: (alt: number) => void;
  back: () => void;
  apply: () => void;
  undo: () => void;
  close: () => void;
}

/** State and actions of the “Change h(n)” tool, shared by the side panel and the canvas. */
export function useHTool(state: EditorState, dispatch: Dispatch<EditorAction>, marks: SessionMarks): HTool {
  const { graph, problem } = state;
  const { lengthsSet, markH } = marks;
  const [edit, setEdit] = useState<HEdit | null>(null);

  const key = useMemo(() => JSON.stringify([graph, problem.heuristic, problem.goal]), [graph, problem.heuristic, problem.goal]);
  const nodeId = edit?.nodeId ?? null;
  const node = nodeId ? graph.nodes.find((n) => n.id === nodeId) : undefined;
  const active = edit && node ? edit : null;
  const moves = useMemo(() => (nodeId && node ? hMoves(graph, nodeId) : []), [graph, nodeId, node]);

  const stale = !!active?.result && active.resultKey !== key;
  const result = active?.phase === "result" && !stale ? active.result : null;
  const proposal = result?.ok ? (result.proposals[active!.alt] ?? null) : null;
  const currentOverride = (id: string) => problem.hOverrides[id] ?? null;
  const canUndo =
    active?.phase === "applied" &&
    !!active.undo &&
    (!active.undo.positions || positionsMatch(graph, active.undo.positions.after)) &&
    currentOverride(active.nodeId) === active.undo.override.after;
  const previewPositions = useMemo(
    () => (proposal && nodeId ? { [nodeId]: proposal.position } : undefined),
    [proposal, nodeId],
  );

  const run = useCallback(
    (e: HEdit, target = e.target): HEdit => {
      const res = adjustH(graph, problem, e.nodeId, target, e.choice, { protectedEdges: lengthsSet });
      return { ...e, target, phase: "result", result: res, resultKey: key, alt: 0, undo: undefined };
    },
    [graph, problem, lengthsSet, key],
  );

  const start = useCallback((id: string, target: number) => {
    setEdit({ nodeId: id, target, choice: { kind: "any" }, phase: "choose", result: null, resultKey: null, alt: 0 });
  }, []);
  const close = useCallback(() => setEdit(null), []);

  /** Clicking one of the state's edges keeps it (clicking it again goes back to “any edge”). */
  const keepEdge = useCallback(
    (edgeId: string) => {
      const move = moves.find((m) => m.kept?.edgeIds.includes(edgeId));
      if (!move) return;
      setEdit((e) => {
        if (!e) return e;
        const already = e.choice.kind === "keep" && move.kept!.edgeIds.includes(e.choice.edgeId);
        const choice: HChoice = already ? { kind: "any" } : { kind: "keep", edgeId: move.kept!.edgeIds[0] };
        return { ...e, choice, phase: "choose", result: null };
      });
    },
    [moves],
  );

  const overlay = useMemo<CanvasOverlay | undefined>(() => {
    if (!active || !node || active.phase === "applied") return undefined;
    const choice = active.choice;
    const kept = proposal
      ? proposal.move
      : choice.kind === "keep"
        ? moves.find((m) => m.kept?.edgeIds.includes(choice.edgeId))
        : undefined;
    const pivot = kept?.pivot && graph.nodes.find((n) => n.id === kept.pivot!.id);
    return {
      kind: "h",
      phase: proposal ? "preview" : "choose",
      targetEdgeIds: new Set(),
      targetNodeId: node.id,
      affected: new Set(moves.flatMap((m) => m.kept?.edgeIds ?? [])),
      locked: new Set(kept?.kept?.edgeIds ?? []),
      changed: proposal ? new Set(proposal.changed.flatMap((c) => c.edgeIds)) : undefined,
      ghosts: proposal ? [{ id: node.id, x: node.x, y: node.y }] : undefined,
      guide: pivot ? { cx: pivot.x, cy: pivot.y, r: Math.hypot(node.x - pivot.x, node.y - pivot.y) } : undefined,
      onEdgeClick: keepEdge,
    };
  }, [active, node, proposal, moves, graph, keepEdge]);

  return {
    edit: active,
    moves,
    proposal,
    previewPositions,
    stale,
    canUndo,
    overlay,
    title: active && active.phase !== "applied" ? `h(${nameOf(graph, active.nodeId)})` : null,
    marks,
    start,
    close,
    setTarget: (target) => active && setEdit(active.phase === "result" ? run(active, target) : { ...active, target }),
    choose: (choice) => active && setEdit({ ...active, choice, phase: "choose", result: null }),
    override: () => {
      if (!active) return;
      const before = currentOverride(active.nodeId);
      dispatch({ type: "setHOverride", nodeId: active.nodeId, value: active.target });
      setEdit({
        ...active,
        phase: "applied",
        result: null,
        undo: { override: { before, after: active.target }, wasSet: marks.hSet.has(active.nodeId) },
      });
    },
    clearOverride: () => active && dispatch({ type: "setHOverride", nodeId: active.nodeId, value: null }),
    compute: (target) => active && setEdit(run(active, target)),
    pickClosest: () => {
      const res = active?.result;
      if (!active || !res || res.ok || res.reason !== "range" || !res.closest) return;
      const closest = res.closest;
      setEdit({ ...active, target: closest.h, alt: 0, result: { ok: true, proposals: [closest], stats: res.stats } });
    },
    setAlt: (alt) => active && setEdit({ ...active, alt }),
    back: () => active && setEdit({ ...active, phase: "choose", result: null }),
    apply: () => {
      if (!active || !proposal || !previewPositions) return;
      const before = currentPositions(graph, previewPositions);
      dispatch({ type: "setPositions", positions: previewPositions });
      // The heuristic now gives the target here, so an override would only hide it.
      const overrideBefore = currentOverride(active.nodeId);
      if (overrideBefore !== null) dispatch({ type: "setHOverride", nodeId: active.nodeId, value: null });
      const wasSet = marks.hSet.has(active.nodeId);
      markH(active.nodeId, true);
      setEdit({
        ...active,
        phase: "applied",
        result: null,
        undo: { positions: { before, after: previewPositions }, override: { before: overrideBefore, after: null }, wasSet },
      });
    },
    undo: () => {
      if (!active?.undo || !canUndo) return;
      const { positions, override, wasSet } = active.undo;
      if (positions) dispatch({ type: "setPositions", positions: positions.before });
      if (override.before !== override.after)
        dispatch({ type: "setHOverride", nodeId: active.nodeId, value: override.before });
      if (positions && !wasSet) markH(active.nodeId, false);
      setEdit({ ...active, phase: "choose", result: null, undo: undefined });
    },
  };
}

interface Props {
  tool: HTool;
  state: EditorState;
  evaluated: EvaluatedGraph;
  heuristic: HeuristicTable | null;
}

/** The “Change h(n)” panel: choose which edge keeps its length, compute, preview, apply or undo. */
export default function HPanel({ tool, state, evaluated, heuristic }: Props) {
  const { edit } = tool;
  if (!edit) return null;
  const node = evaluated.nodeById.get(edit.nodeId)!;
  const current = heuristic?.values[edit.nodeId];
  const overridden = edit.nodeId in state.problem.hOverrides;
  const computed = heuristic?.overridden[edit.nodeId];
  const h = `h(${node.name})`;
  const show = (v: number | null | undefined) => (v === null || v === undefined ? "⚠" : formatNumber(v));

  if (edit.phase === "applied")
    return (
      <div className={styles.sectionBody}>
        <p className={styles.okText}>
          {h} is now {show(current)}
          {overridden ? ` (an override; the heuristic gives ${show(computed)})` : ""}.
        </p>
        <div className={styles.row}>
          {tool.canUndo && <button onClick={tool.undo}>Undo</button>}
          <button onClick={tool.close}>Done</button>
        </div>
      </div>
    );

  const result = edit.phase === "result" && !tool.stale ? edit.result : null;
  const choiceValue = edit.choice.kind === "keep" ? edit.choice.edgeId : edit.choice.kind;
  const options: [value: string, label: ReactNode][] = [
    ["any", "any edge (smallest move)"],
    ...tool.moves.flatMap((m): [string, ReactNode][] =>
      m.kept
        ? [
            [
              m.kept.edgeIds[0],
              <>
                <span>
                  {m.kept.a} – {m.kept.b}
                </span>
                <span className={styles.lockLength}>{formatNumber(m.kept.length)}</span>
                {m.kept.edgeIds.some((id) => tool.marks.lengthsSet.has(id)) && (
                  <span className={styles.badge}>set earlier</span>
                )}
              </>,
            ],
          ]
        : [],
    ),
    ["free", "no edge (move freely)"],
  ];

  return (
    <div className={styles.sectionBody}>
      <div className={styles.row}>
        <span>
          <strong>{h}</strong>: {current === null || current === undefined ? "⚠" : formatNumber(current)} →
        </span>
        <NumberInput value={edit.target} min={0} step={0.1} aria-label="New h" onCommit={(v) => tool.setTarget(v)} />
      </div>
      <p className={styles.muted}>Heuristic: {heuristicLabel(state.problem)}</p>
      {overridden && (
        <div className={styles.row}>
          <span className={styles.muted}>
            {h} is overridden; the heuristic gives {show(computed)}.
          </span>
          <button onClick={tool.clearOverride}>Clear override</button>
        </div>
      )}

      {!result && (
        <>
          <div className={styles.row}>
            <button onClick={tool.override}>
              Override: set {h} = {formatNumber(edit.target)}
            </button>
          </div>
          <p className={styles.muted}>
            Nothing moves; this value replaces what the heuristic computes for {node.name}.
          </p>
          <p className={styles.muted}>
            <strong>Or move {node.name}</strong> until the heuristic gives {formatNumber(edit.target)}, keeping the length of:
          </p>
          <ul className={styles.lockList} role="radiogroup" aria-label="Edge to keep">
            {options.map(([value, label]) => (
              <li key={value}>
                <label className={styles.toggle}>
                  <input
                    type="radio"
                    name="h-keep"
                    checked={choiceValue === value}
                    onChange={() =>
                      tool.choose(value === "any" || value === "free" ? { kind: value } : { kind: "keep", edgeId: value })
                    }
                  />
                  {label}
                </label>
              </li>
            ))}
          </ul>
          <p className={styles.muted}>
            Only {node.name} moves: it rotates about the other end of the kept edge, so its other edges change length. You
            can also click an edge of {node.name} on the canvas.
          </p>
          {tool.stale && <p className={styles.warnText}>The graph changed since the last result. Compute again.</p>}
          <div className={styles.row}>
            <button className="primary" onClick={() => tool.compute()}>
              Compute move
            </button>
            <button onClick={tool.close}>Cancel</button>
          </div>
        </>
      )}

      {result && <HResultView tool={tool} result={result} name={node.name} target={edit.target} />}
    </div>
  );
}

function HResultView({ tool, result, name, target }: { tool: HTool; result: HResult; name: string; target: number }) {
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
    let message: string;
    if (result.reason === "invalid") message = result.message;
    else if (result.reason === "constant")
      message = `h(${name}) stays ${formatNumber(result.value)} wherever ${name} moves: this heuristic doesn't depend on its position.`;
    else {
      const choice = edit!.choice;
      const kept = choice.kind === "keep" ? tool.moves.find((m) => m.kept?.edgeIds.includes(choice.edgeId))?.kept : undefined;
      const how = kept
        ? `keeping ${kept.a} – ${kept.b}`
        : choice.kind === "free"
          ? `moving ${name} in a straight line`
          : `however ${name} moves (keeping one edge or none)`;
      message = `Out of reach: ${how}, h(${name}) ranges from ${formatNumber(result.min)} to ${formatNumber(result.max)}.`;
    }
    return (
      <>
        <p className={styles.error}>{message}</p>
        <div className={styles.row}>
          {result.reason === "range" && result.closest && (
            <button onClick={tool.pickClosest}>Use h = {formatNumber(result.closest.h)}</button>
          )}
          <button onClick={tool.override}>
            Override instead: h({name}) = {formatNumber(target)}
          </button>
        </div>
        {buttons}
      </>
    );
  }

  const p = proposal!;
  const kept = p.move.kept;
  const setEarlier = (ids: string[]) => ids.some((id) => tool.marks.lengthsSet.has(id));
  return (
    <>
      <p className={styles.okText}>
        {p.motion}
        {kept ? `, keeping ${kept.a} – ${kept.b}` : ""}.
      </p>
      <p className={styles.muted}>
        h({name}) becomes {formatNumber(p.h)}; {name} moves {formatNumber(p.distance)} units.
      </p>
      {p.changed.length === 0 ? (
        <p className={styles.muted}>No other edge changes.</p>
      ) : (
        <>
          <p className={p.changed.some((c) => setEarlier(c.edgeIds)) ? styles.warnText : styles.muted}>
            Other edges of {name} change:
          </p>
          <ul className={styles.plainList}>
            {p.changed.map((c) => (
              <li key={c.edgeIds[0]}>
                {c.a} – {c.b}: {formatNumber(c.length)} → {formatNumber(c.after)}{" "}
                {setEarlier(c.edgeIds) && <span className={styles.badge}>set earlier</span>}
              </li>
            ))}
          </ul>
        </>
      )}
      <HChangeList changes={p.hChanges} hSet={tool.marks.hSet} />
      <AltNav
        index={edit!.alt}
        count={result.proposals.length}
        label={kept ? `keeps ${kept.a} – ${kept.b}` : "no edge kept"}
        onChange={tool.setAlt}
      />
      <p className={styles.muted}>
        Computed in {Math.max(1, Math.round(result.stats.ms))} ms ({result.stats.evaluations} evaluations of h).
      </p>
      {buttons}
    </>
  );
}

function heuristicLabel(problem: Problem): string {
  const resolved = resolveHeuristic(problem.heuristic);
  return resolved.ok ? resolved.heuristic.label : "(invalid)";
}
