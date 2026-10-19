"use client";

import type { Dispatch } from "react";
import type { Problem } from "@/model/schema";
import type { EditorAction } from "@/state/editorReducer";
import { formatNumber } from "./format";
import NumberInput from "./NumberInput";
import type { HChange } from "./tools";
import styles from "./Editor.module.css";

/**
 * h(n) as an editable value. Manual values are set directly. For other heuristics a new value opens
 * the “Change h(n)” tool, which can override the value or move the state; where moving can't help
 * (zero heuristic, the goal itself, or a heuristic that fails there) the value becomes an override.
 * Overridden values are marked ✎ with a button that restores the heuristic's own value.
 */
export function HValueInput({
  problem,
  nodeId,
  h,
  error,
  computed,
  dispatch,
  onRequestH,
}: {
  problem: Problem;
  nodeId: string;
  h: number | null | undefined;
  error?: string;
  /** What the heuristic itself gives, when the value is overridden (see HeuristicTable.overridden). */
  computed?: number | null;
  dispatch: Dispatch<EditorAction>;
  onRequestH: (nodeId: string, h: number) => void;
}) {
  const ref = problem.heuristic;
  if (ref.kind === "builtin" && ref.id === "manual")
    return (
      <NumberInput
        value={problem.manualH[nodeId]}
        placeholder="0"
        step={0.1}
        aria-label="h"
        onCommit={(value) => dispatch({ type: "setManualH", nodeId, value })}
      />
    );
  const overridden = nodeId in problem.hOverrides;
  const fixed = (ref.kind === "builtin" && ref.id === "zero") || problem.goal === nodeId;
  const setOverride = (value: number | null) => dispatch({ type: "setHOverride", nodeId, value });
  return (
    <span className={styles.hValue}>
      <NumberInput
        value={h ?? undefined}
        min={0}
        step={0.1}
        aria-label="h"
        placeholder={h === null ? "⚠" : undefined}
        title={h === null ? error : "Type a value to override h or to move the state until h has it"}
        onCommit={(v) => {
          if (h !== null && h !== undefined && Math.abs(v - h) <= 1e-9) return;
          if (fixed || overridden || h === null || h === undefined) setOverride(v);
          else onRequestH(nodeId, v);
        }}
      />
      {overridden && (
        <button
          className={styles.clearOverride}
          title={`Overrides the heuristic (${computed === null || computed === undefined ? "⚠" : formatNumber(computed)}). Click to use the heuristic's value again.`}
          aria-label="Clear override"
          onClick={(e) => {
            e.stopPropagation();
            setOverride(null);
          }}
        >
          ✎×
        </button>
      )}
    </span>
  );
}

/** ◀ Option i of n ▶ — browse alternative proposals. */
export function AltNav({
  index,
  count,
  label,
  onChange,
}: {
  index: number;
  count: number;
  label: string;
  onChange: (index: number) => void;
}) {
  if (count < 2) return null;
  return (
    <div className={styles.row}>
      <button aria-label="Previous option" disabled={index === 0} onClick={() => onChange(index - 1)}>
        ◀
      </button>
      <span>
        Option {index + 1} of {count}
        <span className={styles.muted}> · {label}</span>
      </span>
      <button aria-label="Next option" disabled={index === count - 1} onClick={() => onChange(index + 1)}>
        ▶
      </button>
    </div>
  );
}

/** Other states whose h changes; those set earlier in this session are marked. */
export function HChangeList({ changes, hSet }: { changes: HChange[]; hSet: ReadonlySet<string> }) {
  if (!changes.length) return null;
  const value = (h: number | null) => (h === null ? "⚠" : formatNumber(h));
  return (
    <>
      <p className={changes.some((c) => hSet.has(c.id)) ? styles.warnText : styles.muted}>h also changes for:</p>
      <ul className={styles.plainList}>
        {changes.map((c) => (
          <li key={c.id}>
            {c.name}: {value(c.before)} → {value(c.after)}{" "}
            {hSet.has(c.id) && <span className={styles.badge}>set earlier</span>}
          </li>
        ))}
      </ul>
    </>
  );
}
