import type { CostModel } from "./types";

export const euclideanCost: CostModel = {
  id: "euclidean",
  label: "Euclidean × friction",
  description: "Straight-line length of the edge (in graph units) multiplied by its friction factor (≥ 1).",
  cost: (edge, from, to, ctx) => ctx.euclidean(from, to) * edge.friction,
};

export const manualCost: CostModel = {
  id: "manual",
  label: "Manual",
  description: "Each edge's cost is entered by hand in the inspector.",
  cost: (edge) => {
    if (edge.manualCost === undefined) throw new Error("No manual cost set");
    return edge.manualCost;
  },
};

export const unitCost: CostModel = {
  id: "unit",
  label: "Unit cost (1 per action)",
  description: "Every action costs 1, i.e. path cost = number of steps.",
  cost: () => 1,
};
