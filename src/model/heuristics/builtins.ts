import type { Heuristic } from "./types";

export const straightLine: Heuristic = {
  id: "straight-line",
  label: "Straight-line distance",
  description:
    "Euclidean (air) distance from the node to the goal, in the same units as the Euclidean edge costs.",
  h: (node, ctx) => ctx.euclidean(node, ctx.goal),
};

export const manhattanDistance: Heuristic = {
  id: "manhattan",
  label: "Manhattan distance",
  description: "City-block distance |dx| + |dy| to the goal, in graph units.",
  h: (node, ctx) => ctx.manhattan(node, ctx.goal),
};

export const zero: Heuristic = {
  id: "zero",
  label: "Zero (h = 0)",
  description: "Uninformed baseline: always 0. A* then behaves like uniform-cost search.",
  h: () => 0,
};

export const manualHeuristic: Heuristic = {
  id: "manual",
  label: "Manual",
  description: "Values typed in per node in the heuristic table (missing values count as 0).",
  h: (node, ctx) => ctx.problem.manualH[node.id] ?? 0,
};
