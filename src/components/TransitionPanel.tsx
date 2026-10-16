"use client";

import type { Dispatch } from "react";
import type { EvaluatedGraph } from "@/model/actions";
import type { EditorAction, EditorState } from "@/state/editorReducer";
import { formatNumber } from "./format";
import styles from "./Editor.module.css";

/** The transition model: ACTIONS(s), RESULT(s, a) and c(s, a, s') for every state. */
export default function TransitionPanel({
  state,
  dispatch,
  evaluated,
}: {
  state: EditorState;
  dispatch: Dispatch<EditorAction>;
  evaluated: EvaluatedGraph;
}) {
  const nodes = [...state.graph.nodes].sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
  if (nodes.length === 0) return <div className={styles.sectionBody}><p className={styles.muted}>No states yet.</p></div>;
  return (
    <div className={styles.sectionBody}>
      <table className={styles.table}>
        <thead>
          <tr>
            <th>s</th>
            <th>ACTIONS(s) → cost</th>
          </tr>
        </thead>
        <tbody>
          {nodes.map((n) => (
            <tr key={n.id} onClick={() => dispatch({ type: "select", selection: { kind: "node", id: n.id } })}>
              <td>{n.name}</td>
              <td>
                <ul className={styles.actionsList}>
                  {(evaluated.actions[n.id] ?? []).map((a) => (
                    <li key={`${a.edgeId}-${a.to}`}>
                      {a.name} {a.cost === null ? <span className={styles.error} title={a.error}>⚠</span> : formatNumber(a.cost)}
                    </li>
                  ))}
                  {(evaluated.actions[n.id] ?? []).length === 0 && <li className={styles.muted}>—</li>}
                </ul>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
