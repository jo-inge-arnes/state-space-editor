import type { Action } from "../actions";
import type { Metrics } from "../geometry";
import type { Problem, StateNode, StateSpaceGraph } from "../schema";

export interface HeuristicContext extends Metrics {
  graph: StateSpaceGraph;
  problem: Problem;
  nodeById: Map<string, StateNode>;
  goal: StateNode;
  /** ACTIONS(s) with resolved costs, keyed by node id. */
  actions: Record<string, Action[]>;
}

/** Estimates h(n): the cost of the cheapest path from `node` to the goal. */
export interface Heuristic {
  id: string;
  label: string;
  description: string;
  h(node: StateNode, ctx: HeuristicContext): number;
}
