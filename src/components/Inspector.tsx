"use client";

import { useLayoutEffect, useRef, useState, type Dispatch } from "react";
import type { EvaluatedGraph } from "@/model/actions";
import type { HeuristicTable } from "@/model/heuristics/registry";
import type { Edge, StateNode } from "@/model/schema";
import type { EditorAction, EditorState } from "@/state/editorReducer";
import { formatNumber } from "./format";
import NumberInput from "./NumberInput";
import { HValueInput } from "./ToolParts";
import styles from "./Editor.module.css";

interface Props {
  state: EditorState;
  dispatch: Dispatch<EditorAction>;
  evaluated: EvaluatedGraph;
  heuristic: HeuristicTable | null;
  /** Node whose name field should get focus (set by double-clicking a node). */
  renameRequest: string | null;
  onRenameHandled: () => void;
  /** Open the “Change length” tool for an edge with a new target length (units). */
  onRequestLength: (edgeId: string, length: number) => void;
  /** Open the “Change h(n)” tool for a state with a target h. */
  onRequestH: (nodeId: string, h: number) => void;
}

export default function Inspector(props: Props) {
  const { state, dispatch, evaluated } = props;
  const { selection, graph } = state;
  if (selection?.kind === "node") {
    const node = evaluated.nodeById.get(selection.id);
    if (node)
      return (
<NodeInspector key={node.id} {...props} node={node} />
      );
  }
  if (selection?.kind === "edge") {
    const edge = graph.edges.find((e) => e.id === selection.id);
    if (edge)
      return (
        <EdgeInspector
          key={edge.id}
          edge={edge}
          state={state}
          dispatch={dispatch}
          evaluated={evaluated}
          onRequestLength={props.onRequestLength}
        />
      );
  }
  return (
    <div className={styles.sectionBody}>
      <p className={styles.muted}>Nothing selected.</p>
      <p className={styles.muted}>
        <kbd>V</kbd> select/move · <kbd>N</kbd> add states · <kbd>E</kbd> add actions (edges) · <kbd>Del</kbd> delete
        · <kbd>Esc</kbd> cancel
      </p>
    </div>
  );
}

function NodeInspector({
  node,
  state,
  dispatch,
  evaluated,
  heuristic,
  renameRequest,
  onRenameHandled,
  onRequestH,
}: Props & { node: StateNode }) {
  const { graph, problem } = state;
  const [name, setName] = useState(node.name);
  const [prevName, setPrevName] = useState(node.name);
  const inputRef = useRef<HTMLInputElement>(null);

  // Follow renames made elsewhere (e.g. loading a file).
  if (node.name !== prevName) {
    setPrevName(node.name);
    setName(node.name);
  }

  // Layout effect: runs inside the double-tap's event (the rename request is flushed synchronously),
  // which iOS requires before it shows the keyboard for a programmatic focus.
  useLayoutEffect(() => {
    if (renameRequest !== node.id) return;
    inputRef.current?.focus();
    inputRef.current?.select();
    onRenameHandled();
  }, [renameRequest, node.id, onRenameHandled]);

  const trimmed = name.trim();
  const nameError = !trimmed
    ? "Name can't be empty"
    : graph.nodes.some((n) => n.id !== node.id && n.name === trimmed)
      ? "Another state already has this name"
      : null;
  const commit = () => {
    if (!nameError) dispatch({ type: "renameNode", id: node.id, name: trimmed });
    else setName(node.name);
  };

  const unit = graph.pxPerUnit;
  const h = heuristic?.values[node.id];
  const hErr = heuristic?.errors[node.id];
  const actions = evaluated.actions[node.id] ?? [];

  return (
    <div className={styles.sectionBody}>
      <label className={styles.field}>
        <span>State name</span>
        <input
          ref={inputRef}
          value={name}
          onChange={(e) => setName(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === "Enter") e.currentTarget.blur();
            if (e.key === "Escape") setName(node.name);
          }}
        />
      </label>
      {nameError && trimmed !== node.name && <p className={styles.error}>{nameError}</p>}
      <div className={styles.field}>
        <span>Position (units)</span>
        <div className={styles.row}>
          <NumberInput
            value={node.x / unit}
            step={0.25}
            aria-label="x"
            onCommit={(x) => dispatch({ type: "moveNode", id: node.id, x: x * unit, y: node.y })}
          />
          <NumberInput
            value={node.y / unit}
            step={0.25}
            aria-label="y"
            onCommit={(y) => dispatch({ type: "moveNode", id: node.id, x: node.x, y: y * unit })}
          />
        </div>
      </div>
      <div className={styles.field}>
        <span>Id</span>
        <code>{node.id}</code>
      </div>
      <div className={styles.row}>
        <button
          onClick={() => dispatch({ type: "setProblem", patch: { initial: problem.initial === node.id ? null : node.id } })}
        >
          {problem.initial === node.id ? "Unset initial" : "Set as initial"}
        </button>
        <button onClick={() => dispatch({ type: "setProblem", patch: { goal: problem.goal === node.id ? null : node.id } })}>
          {problem.goal === node.id ? "Unset goal" : "Set as goal"}
        </button>
        <button className="danger" onClick={() => dispatch({ type: "deleteNode", id: node.id })}>
          Delete
        </button>
      </div>
      {heuristic && !heuristic.error && (
        <div className={styles.field}>
          <span>h(n)</span>
          <span>
            <HValueInput
              problem={problem}
              nodeId={node.id}
              h={h}
              error={hErr}
              computed={heuristic.overridden[node.id]}
              dispatch={dispatch}
              onRequestH={onRequestH}
            />
          </span>
        </div>
      )}
      <div>
        <p className={styles.muted}>ACTIONS({node.name})</p>
        {actions.length === 0 ? (
          <p className={styles.muted}>None — a dead end.</p>
        ) : (
          <ul className={styles.actionsList}>
            {actions.map((a) => (
              <li key={`${a.edgeId}-${a.to}`}>
                {a.name} → cost {a.cost === null ? <span className={styles.error}>⚠ {a.error}</span> : formatNumber(a.cost)}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function EdgeInspector({
  edge,
  state,
  dispatch,
  evaluated,
  onRequestLength,
}: {
  edge: Edge;
  state: EditorState;
  dispatch: Dispatch<EditorAction>;
  evaluated: EvaluatedGraph;
  onRequestLength: (edgeId: string, length: number) => void;
}) {
  const { graph } = state;
  const from = evaluated.nodeById.get(edge.from)!;
  const to = evaluated.nodeById.get(edge.to)!;
  const info = evaluated.edges[edge.id];
  const hasOpposite = graph.edges.some((e) => e.from === edge.to && e.to === edge.from);
  const isManual = graph.costModel.kind === "builtin" && graph.costModel.id === "manual";
  const isEuclidean = graph.costModel.kind === "builtin" && graph.costModel.id === "euclidean";

  return (
    <div className={styles.sectionBody}>
      <p>
        <strong>{from.name}</strong> {edge.directed ? "→" : "↔"} <strong>{to.name}</strong>{" "}
        <span className={styles.muted}>({edge.id})</span>
      </p>
      <label className={styles.toggle}>
        <input
          type="checkbox"
          checked={edge.directed}
          disabled={hasOpposite}
          onChange={(e) => dispatch({ type: "updateEdge", id: edge.id, patch: { directed: e.target.checked } })}
        />
        One-way (directed)
      </label>
      {hasOpposite && <p className={styles.muted}>Paired with an opposite one-way edge, so it stays one-way.</p>}
      {edge.directed && (
        <div className={styles.row}>
          <button disabled={hasOpposite} onClick={() => dispatch({ type: "reverseEdge", id: edge.id })}>
            Reverse direction
          </button>
        </div>
      )}
      <label className={styles.field}>
        <span>Friction (×)</span>
        <NumberInput
          value={edge.friction}
          min={1}
          step={0.1}
          onCommit={(friction) => dispatch({ type: "updateEdge", id: edge.id, patch: { friction } })}
        />
      </label>
      {!isEuclidean && <p className={styles.muted}>Friction is used by the Euclidean cost model (and custom functions that read it).</p>}
      <label className={styles.field}>
        <span>Manual cost</span>
        <NumberInput
          value={edge.manualCost}
          min={0}
          step={0.1}
          placeholder="not set"
          onCommit={(manualCost) => dispatch({ type: "updateEdge", id: edge.id, patch: { manualCost } })}
        />
      </label>
      {!isManual && <p className={styles.muted}>Manual costs apply when the cost model is “Manual”.</p>}
      {info && (
        <table className={styles.table}>
          <tbody>
            <tr>
              <th>Length (units)</th>
              <td className={styles.num}>
                <NumberInput
                  value={info.length}
                  min={0.0001}
                  step={0.1}
                  aria-label="Length"
                  onCommit={(v) => {
                    if (v > 0 && Math.abs(v - info.length) > 1e-9) onRequestLength(edge.id, v);
                  }}
                />
              </td>
            </tr>
            <ActionRow label={`c(${from.name}, ${info.forward.name})`} cost={info.forward.cost} error={info.forward.error} />
            {info.backward && (
              <ActionRow label={`c(${to.name}, ${info.backward.name})`} cost={info.backward.cost} error={info.backward.error} />
            )}
          </tbody>
        </table>
      )}
      <p className={styles.muted}>
        Enter a new length to move states so that as few other edges as possible change.
      </p>
      <div className={styles.row}>
        <button className="danger" onClick={() => dispatch({ type: "deleteEdge", id: edge.id })}>
          Delete edge
        </button>
      </div>
    </div>
  );
}

function ActionRow({ label, cost, error }: { label: string; cost: number | null; error?: string }) {
  return (
    <tr>
      <th>{label}</th>
      <td className={styles.num}>{cost === null ? <span className={styles.error}>⚠ {error}</span> : formatNumber(cost)}</td>
    </tr>
  );
}
