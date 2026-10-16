import type { Metrics } from "../geometry";
import type { Edge, StateNode, StateSpaceGraph } from "../schema";

export interface CostContext extends Metrics {
  graph: StateSpaceGraph;
  nodeById: Map<string, StateNode>;
}

/**
 * Computes the step cost c(s, a, s') of taking `edge` from `from` to `to`.
 * For undirected edges it is called once per direction, so models may be asymmetric.
 */
export interface CostModel {
  id: string;
  label: string;
  description: string;
  cost(edge: Edge, from: StateNode, to: StateNode, ctx: CostContext): number;
}
