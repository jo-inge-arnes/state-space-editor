import type { StateNode } from "./schema";

type Point = Pick<StateNode, "x" | "y">;

/** Straight-line distance in pixels. */
export function pixelDistance(a: Point, b: Point): number {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

/** Straight-line distance in graph units (pixels / pxPerUnit). */
export function euclidean(a: Point, b: Point, pxPerUnit: number): number {
  return pixelDistance(a, b) / pxPerUnit;
}

/** Manhattan (city block) distance in graph units. */
export function manhattan(a: Point, b: Point, pxPerUnit: number): number {
  return (Math.abs(b.x - a.x) + Math.abs(b.y - a.y)) / pxPerUnit;
}

/** Distance helpers bound to a graph's scale, handed to cost models and heuristics. */
export interface Metrics {
  /** Straight-line distance in graph units. */
  euclidean(a: Point, b: Point): number;
  /** City-block distance in graph units. */
  manhattan(a: Point, b: Point): number;
  pxPerUnit: number;
}

export function metricsFor(pxPerUnit: number): Metrics {
  return {
    pxPerUnit,
    euclidean: (a, b) => euclidean(a, b, pxPerUnit),
    manhattan: (a, b) => manhattan(a, b, pxPerUnit),
  };
}
