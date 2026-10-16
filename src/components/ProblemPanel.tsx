"use client";

import type { Dispatch } from "react";
import {
  listHeuristics,
  USER_HEURISTIC_PARAMS,
  USER_HEURISTIC_TEMPLATE,
  type HeuristicTable,
} from "@/model/heuristics/registry";
import type { EditorAction, EditorState } from "@/state/editorReducer";
import { formatNumber } from "./format";
import FunctionPicker from "./FunctionPicker";
import NumberInput from "./NumberInput";
import styles from "./Editor.module.css";

const heuristics = listHeuristics();

interface Props {
  state: EditorState;
  dispatch: Dispatch<EditorAction>;
  heuristic: HeuristicTable | null;
}

export default function ProblemPanel({ state, dispatch, heuristic }: Props) {
  const { graph, problem, selection } = state;
  const isManual = problem.heuristic.kind === "builtin" && problem.heuristic.id === "manual";
  const nodes = [...graph.nodes].sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
  const heuristicErrors = heuristic ? Object.keys(heuristic.errors).length : 0;
  const noGoal = !heuristic || heuristic.error?.startsWith("Choose");

  const nodeSelect = (label: string, field: "initial" | "goal") => (
    <label className={styles.field}>
      <span>{label}</span>
      <select
        value={problem[field] ?? ""}
        onChange={(e) => dispatch({ type: "setProblem", patch: { [field]: e.target.value || null } })}
      >
        <option value="">— choose —</option>
        {nodes.map((n) => (
          <option key={n.id} value={n.id}>
            {n.name}
          </option>
        ))}
      </select>
    </label>
  );

  return (
    <div className={styles.sectionBody}>
      <label className={styles.field}>
        <span>Problem name</span>
        <input value={problem.name} onChange={(e) => dispatch({ type: "setProblem", patch: { name: e.target.value } })} />
      </label>
      {nodeSelect("Initial state", "initial")}
      {nodeSelect("Goal state", "goal")}
      <div className={styles.row}>
        <button
          disabled={!problem.initial && !problem.goal}
          onClick={() => dispatch({ type: "setProblem", patch: { initial: problem.goal, goal: problem.initial } })}
        >
          Swap initial ⇄ goal
        </button>
      </div>

      <FunctionPicker
        label="Heuristic h(n)"
        options={heuristics}
        value={problem.heuristic}
        onChange={(ref) => dispatch({ type: "setProblem", patch: { heuristic: ref } })}
        signature="h(node, ctx)"
        params={USER_HEURISTIC_PARAMS}
        template={USER_HEURISTIC_TEMPLATE}
        runtimeError={
          noGoal
            ? undefined
            : (heuristic?.error ?? (heuristicErrors > 0 ? `${heuristicErrors} node(s) failed (shown with ⚠).` : undefined))
        }
      />

      {heuristic?.error ? (
        noGoal ? (
          <p className={styles.muted}>{heuristic.error}</p>
        ) : (
          problem.heuristic.kind === "builtin" && <p className={styles.error}>{heuristic.error}</p>
        )
      ) : (
        heuristic && (
          <>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>State</th>
                  <th style={{ textAlign: "right" }} title="Estimated cost from the state to the goal">
                    h(n)
                  </th>
                </tr>
              </thead>
              <tbody>
                {nodes.map((n) => {
                  const h = heuristic.values[n.id];
                  const err = heuristic.errors[n.id];
                  const selected = selection?.kind === "node" && selection.id === n.id;
                  return (
                    <tr
                      key={n.id}
                      className={selected ? styles.rowSelected : undefined}
                      onClick={() => dispatch({ type: "select", selection: { kind: "node", id: n.id } })}
                    >
                      <td>
                        {n.name}
                        {problem.initial === n.id && <span className={styles.okText}> (start)</span>}
                        {problem.goal === n.id && <span className={styles.error}> (goal)</span>}
                      </td>
                      <td className={styles.num}>
                        {isManual ? (
                          <NumberInput
                            value={problem.manualH[n.id]}
                            placeholder="0"
                            step={0.1}
                            onCommit={(value) => dispatch({ type: "setManualH", nodeId: n.id, value })}
                          />
                        ) : h === null || h === undefined ? (
                          <span className={styles.error} title={err}>
                            ⚠ {err}
                          </span>
                        ) : (
                          formatNumber(h)
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <p className={styles.muted}>h(n) is an estimate of the cost from n to the goal, in graph units.</p>
          </>
        )
      )}
    </div>
  );
}
