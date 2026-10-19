import { evaluateGraph, type EvaluatedGraph } from "../actions";
import { metricsFor } from "../geometry";
import type { FunctionRef, Problem, StateSpaceGraph } from "../schema";
import { compileUserFunction, evaluateNumber } from "../userFunctions";
import { manhattanDistance, manualHeuristic, straightLine, zero } from "./builtins";
import type { Heuristic, HeuristicContext } from "./types";

const registry = new Map<string, Heuristic>();

/** Register a built-in heuristic. Add new ones in builtins.ts and list them below. */
export function registerHeuristic(h: Heuristic): void {
  registry.set(h.id, h);
}

[straightLine, manhattanDistance, zero, manualHeuristic].forEach(registerHeuristic);

export function listHeuristics(): Heuristic[] {
  return [...registry.values()];
}

export const USER_HEURISTIC_PARAMS = ["node", "ctx"] as const;

export const USER_HEURISTIC_TEMPLATE = `// Return an estimate h(node) of the cheapest cost from \`node\` to the goal.
// node, ctx.goal: { id, name, x, y }   (x, y in pixels)
// ctx.euclidean(a, b), ctx.manhattan(a, b): distances in graph units
// ctx.actions[nodeId]: [{ name, to, cost }], ctx.graph, ctx.problem, ctx.nodeById
return 0.9 * ctx.euclidean(node, ctx.goal);`;

export type ResolvedHeuristic = { ok: true; heuristic: Heuristic } | { ok: false; error: string };

export function resolveHeuristic(ref: FunctionRef): ResolvedHeuristic {
  if (ref.kind === "builtin") {
    const heuristic = registry.get(ref.id);
    return heuristic ? { ok: true, heuristic } : { ok: false, error: `Unknown heuristic "${ref.id}"` };
  }
  const compiled = compileUserFunction<Heuristic["h"]>(USER_HEURISTIC_PARAMS, ref.source);
  if (!compiled.ok) return compiled;
  return {
    ok: true,
    heuristic: { id: "user", label: ref.name, description: "User-defined heuristic", h: compiled.fn },
  };
}

/** The context every heuristic receives; null when the problem has no goal in this graph. */
export function heuristicContext(
  graph: StateSpaceGraph,
  problem: Problem,
  evaluated: EvaluatedGraph,
): HeuristicContext | null {
  const goal = problem.goal ? evaluated.nodeById.get(problem.goal) : undefined;
  if (!goal) return null;
  return {
    ...metricsFor(graph.pxPerUnit),
    graph,
    problem,
    nodeById: evaluated.nodeById,
    goal,
    actions: evaluated.actions,
  };
}

/**
 * Same context as `heuristicContext`, but the graph is evaluated (costs, ACTIONS) only if the
 * heuristic reads `ctx.actions` or `ctx.nodeById`. For searches that evaluate h many times.
 */
export function lazyHeuristicContext(graph: StateSpaceGraph, problem: Problem): HeuristicContext | null {
  const goal = problem.goal ? graph.nodes.find((n) => n.id === problem.goal) : undefined;
  if (!goal) return null;
  let evaluated: EvaluatedGraph | undefined;
  const ev = () => (evaluated ??= evaluateGraph(graph));
  return {
    ...metricsFor(graph.pxPerUnit),
    graph,
    problem,
    goal,
    get nodeById() {
      return ev().nodeById;
    },
    get actions() {
      return ev().actions;
    },
  };
}

export interface HeuristicTable {
  /** h(n) per node id, after overrides; null where evaluation failed. */
  values: Record<string, number | null>;
  /** For overridden nodes: what the heuristic itself computes (null if it fails). */
  overridden: Record<string, number | null>;
  errors: Record<string, string>;
  /** Set when no table could be computed at all (no goal, unknown heuristic, compile error). */
  error?: string;
}

/**
 * The single entry point for computing heuristic values: every heuristic,
 * built-in or user-defined, is evaluated through here, so they are interchangeable.
 */
export function computeHeuristicTable(
  graph: StateSpaceGraph,
  problem: Problem,
  evaluated: EvaluatedGraph,
): HeuristicTable {
  const ctx = heuristicContext(graph, problem, evaluated);
  if (!ctx) return { values: {}, overridden: {}, errors: {}, error: "Choose a goal node to compute heuristic values." };
  const resolved = resolveHeuristic(problem.heuristic);
  if (!resolved.ok) return { values: {}, overridden: {}, errors: {}, error: resolved.error };

  const values: Record<string, number | null> = {};
  const errors: Record<string, string> = {};
  const overridden: Record<string, number | null> = {};
  for (const node of graph.nodes) {
    const r = evaluateNumber(() => resolved.heuristic.h(node, ctx));
    const override = problem.hOverrides[node.id];
    if (override !== undefined) {
      // A value typed in by the user replaces the function's value (and any error it raised).
      overridden[node.id] = r.ok ? r.value : null;
      values[node.id] = override;
      continue;
    }
    values[node.id] = r.ok ? r.value : null;
    if (!r.ok) errors[node.id] = r.error;
  }
  return { values, overridden, errors };
}
