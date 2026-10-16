import { evaluateGraph, type EvaluatedGraph } from "./actions";
import { resolveCostModel } from "./costs/registry";
import { computeHeuristicTable, resolveHeuristic } from "./heuristics/registry";
import {
  formatZodError,
  graphSchema,
  problemSchema,
  type FunctionRef,
  type GraphDocument,
  type Problem,
  type ProblemDocument,
  type StateSpaceGraph,
} from "./schema";

export type ParseResult<T> = { ok: true; value: T } | { ok: false; error: string };

const finiteOrNull = (n: number | null | undefined) => (n !== null && n !== undefined && Number.isFinite(n) ? n : null);

function refLabel(ref: FunctionRef, resolveLabel: (ref: FunctionRef) => string | undefined): string {
  return ref.kind === "user" ? `user:${ref.name}` : (resolveLabel(ref) ?? ref.id);
}

/** Graph + derived edge costs and ACTIONS(s), ready to be written as JSON. */
export function toGraphDocument(graph: StateSpaceGraph, evaluated = evaluateGraph(graph)): GraphDocument {
  return {
    ...graph,
    derived: {
      costModel: refLabel(graph.costModel, (r) => {
        const m = resolveCostModel(r);
        return m.ok ? m.model.id : undefined;
      }),
      edges: graph.edges.map((e) => {
        const info = evaluated.edges[e.id];
        return {
          id: e.id,
          length: info?.length ?? 0,
          cost: info?.forward.cost ?? null,
          ...(info?.backward ? { reverseCost: info.backward.cost } : {}),
        };
      }),
      actions: Object.fromEntries(
        Object.entries(evaluated.actions).map(([id, list]) => [
          id,
          list.map((a) => ({ action: a.name, to: a.to, cost: a.cost })),
        ]),
      ),
    },
  };
}

/** Problem + derived heuristic table h(n), optionally embedding the graph. */
export function toProblemDocument(
  problem: Problem,
  graph: StateSpaceGraph,
  { embedGraph = false, evaluated = evaluateGraph(graph) }: { embedGraph?: boolean; evaluated?: EvaluatedGraph } = {},
): ProblemDocument {
  const doc: ProblemDocument = { ...problem, graphId: graph.id };
  if (problem.goal && evaluated.nodeById.has(problem.goal)) {
    const table = computeHeuristicTable(graph, problem, evaluated);
    if (!table.error) {
      doc.derived = {
        heuristic: refLabel(problem.heuristic, (r) => {
          const h = resolveHeuristic(r);
          return h.ok ? h.heuristic.id : undefined;
        }),
        h: Object.fromEntries(graph.nodes.map((n) => [n.id, finiteOrNull(table.values[n.id])])),
      };
    }
  }
  if (embedGraph) doc.graph = toGraphDocument(graph, evaluated);
  return doc;
}

function parseJson(text: string): ParseResult<unknown> {
  try {
    return { ok: true, value: JSON.parse(text) };
  } catch (err) {
    return { ok: false, error: `Invalid JSON: ${err instanceof Error ? err.message : String(err)}` };
  }
}

/** Parse a graph file (derived data is dropped; it is recomputed from the core data). */
export function parseGraph(input: unknown): ParseResult<StateSpaceGraph> {
  const json = typeof input === "string" ? parseJson(input) : { ok: true as const, value: input };
  if (!json.ok) return json;
  const r = graphSchema.safeParse(json.value);
  return r.success ? { ok: true, value: r.data } : { ok: false, error: formatZodError(r.error) };
}

/** Parse a problem file; returns the embedded graph too when present. */
export function parseProblem(input: unknown): ParseResult<{ problem: Problem; graph?: StateSpaceGraph }> {
  const json = typeof input === "string" ? parseJson(input) : { ok: true as const, value: input };
  if (!json.ok) return json;
  const r = problemSchema.safeParse(json.value);
  if (!r.success) return { ok: false, error: formatZodError(r.error) };
  const embedded = (json.value as { graph?: unknown }).graph;
  if (embedded === undefined) return { ok: true, value: { problem: r.data } };
  const g = parseGraph(embedded);
  if (!g.ok) return { ok: false, error: `Embedded graph: ${g.error}` };
  return { ok: true, value: { problem: r.data, graph: g.value } };
}

/** Problem node references that don't exist in the graph. */
export function missingProblemNodes(problem: Problem, graph: StateSpaceGraph): string[] {
  const ids = new Set(graph.nodes.map((n) => n.id));
  return [problem.initial, problem.goal].filter((id): id is string => id !== null && !ids.has(id));
}
