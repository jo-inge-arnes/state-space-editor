"use client";

import type { Dispatch } from "react";
import type { EvaluatedGraph } from "@/model/actions";
import { listCostModels, USER_COST_PARAMS, USER_COST_TEMPLATE } from "@/model/costs/registry";
import type { EditorAction, EditorState } from "@/state/editorReducer";
import FunctionPicker from "./FunctionPicker";
import NumberInput from "./NumberInput";
import styles from "./Editor.module.css";

const costModels = listCostModels();

export default function CostModelPanel({
  state,
  dispatch,
  evaluated,
}: {
  state: EditorState;
  dispatch: Dispatch<EditorAction>;
  evaluated: EvaluatedGraph;
}) {
  const { graph } = state;
  const runtimeError =
    evaluated.costModelError ??
    (evaluated.failedActions > 0 ? `${evaluated.failedActions} action(s) have no valid cost (shown with ⚠).` : undefined);

  return (
    <div className={styles.sectionBody}>
      <FunctionPicker
        label="Step cost"
        options={costModels}
        value={graph.costModel}
        onChange={(ref) => dispatch({ type: "setCostModel", ref })}
        signature="cost(edge, from, to, ctx)"
        params={USER_COST_PARAMS}
        template={USER_COST_TEMPLATE}
        runtimeError={runtimeError}
      />
      {graph.costModel.kind === "builtin" && runtimeError && <p className={styles.error}>{runtimeError}</p>}
      <label className={styles.field}>
        <span>Scale (px / unit)</span>
        <NumberInput
          value={graph.pxPerUnit}
          min={1}
          step={10}
          onCommit={(pxPerUnit) => dispatch({ type: "setGraphMeta", patch: { pxPerUnit } })}
        />
      </label>
      <p className={styles.muted}>
        Distances are measured in units: one grid square is 1 unit = {graph.pxPerUnit} px. Euclidean costs and the
        straight-line heuristic use the same scale.
      </p>
    </div>
  );
}
