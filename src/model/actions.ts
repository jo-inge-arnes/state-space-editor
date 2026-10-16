import { resolveCostModel } from "./costs/registry";
import type { CostContext } from "./costs/types";
import { metricsFor } from "./geometry";
import type { Edge, StateNode, StateSpaceGraph } from "./schema";
import { evaluateNumber } from "./userFunctions";

/** One applicable action in ACTIONS(s), with its resolved step cost. */
export interface Action {
  /** Human-readable action name, e.g. "go(B)". */
  name: string;
  edgeId: string;
  from: string;
  to: string;
  /** Step cost, or null if the cost model failed for this action (see `error`). */
  cost: number | null;
  error?: string;
}

export interface EdgeInfo {
  /** Straight-line length in graph units. */
  length: number;
  forward: Action;
  /** Present for undirected edges. */
  backward?: Action;
}

export interface EvaluatedGraph {
  nodeById: Map<string, StateNode>;
  /** ACTIONS(s) for every node id. */
  actions: Record<string, Action[]>;
  edges: Record<string, EdgeInfo>;
  /** Set when the cost model itself can't be used (unknown id, compile error). */
  costModelError?: string;
  /** Number of actions whose cost could not be computed. */
  failedActions: number;
}

export function actionName(target: StateNode): string {
  return `go(${target.name})`;
}

/** Derive the transition model and step costs from the graph's nodes, edges and cost model. */
export function evaluateGraph(graph: StateSpaceGraph): EvaluatedGraph {
  const nodeById = new Map(graph.nodes.map((n) => [n.id, n]));
  const metrics = metricsFor(graph.pxPerUnit);
  const ctx: CostContext = { ...metrics, graph, nodeById };
  const resolved = resolveCostModel(graph.costModel);

  const actions: Record<string, Action[]> = {};
  for (const n of graph.nodes) actions[n.id] = [];
  const edges: Record<string, EdgeInfo> = {};
  let failedActions = 0;

  const makeAction = (edge: Edge, from: StateNode, to: StateNode): Action => {
    const action: Action = { name: actionName(to), edgeId: edge.id, from: from.id, to: to.id, cost: null };
    if (!resolved.ok) {
      action.error = resolved.error;
    } else {
      const r = evaluateNumber(() => resolved.model.cost(edge, from, to, ctx), { nonNegative: true });
      if (r.ok) action.cost = r.value;
      else action.error = r.error;
    }
    if (action.cost === null) failedActions++;
    actions[from.id].push(action);
    return action;
  };

  for (const edge of graph.edges) {
    const from = nodeById.get(edge.from);
    const to = nodeById.get(edge.to);
    if (!from || !to) continue;
    edges[edge.id] = {
      length: metrics.euclidean(from, to),
      forward: makeAction(edge, from, to),
      backward: edge.directed ? undefined : makeAction(edge, to, from),
    };
  }

  return {
    nodeById,
    actions,
    edges,
    costModelError: resolved.ok ? undefined : resolved.error,
    failedActions,
  };
}
