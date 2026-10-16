import type { FunctionRef } from "../schema";
import { compileUserFunction } from "../userFunctions";
import { euclideanCost, manualCost, unitCost } from "./builtins";
import type { CostModel } from "./types";

const registry = new Map<string, CostModel>();

/** Register a built-in cost model. Add new ones in builtins.ts and list them below. */
export function registerCostModel(model: CostModel): void {
  registry.set(model.id, model);
}

[euclideanCost, manualCost, unitCost].forEach(registerCostModel);

export function listCostModels(): CostModel[] {
  return [...registry.values()];
}

export const USER_COST_PARAMS = ["edge", "from", "to", "ctx"] as const;

export const USER_COST_TEMPLATE = `// Return the cost of moving along \`edge\` from node \`from\` to node \`to\`.
// edge: { id, from, to, directed, friction, manualCost }
// from/to: { id, name, x, y }   (x, y in pixels)
// ctx.euclidean(a, b), ctx.manhattan(a, b): distances in graph units
// ctx.pxPerUnit, ctx.graph, ctx.nodeById
return ctx.euclidean(from, to) * edge.friction;`;

export type ResolvedCostModel = { ok: true; model: CostModel } | { ok: false; error: string };

export function resolveCostModel(ref: FunctionRef): ResolvedCostModel {
  if (ref.kind === "builtin") {
    const model = registry.get(ref.id);
    return model ? { ok: true, model } : { ok: false, error: `Unknown cost model "${ref.id}"` };
  }
  const compiled = compileUserFunction<CostModel["cost"]>(USER_COST_PARAMS, ref.source);
  if (!compiled.ok) return compiled;
  return {
    ok: true,
    model: { id: "user", label: ref.name, description: "User-defined cost function", cost: compiled.fn },
  };
}
