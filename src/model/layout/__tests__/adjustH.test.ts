import { describe, expect, it } from "vitest";
import { evaluateGraph } from "@/model/actions";
import { computeHeuristicTable } from "@/model/heuristics/registry";
import type { FunctionRef, Problem, StateSpaceGraph } from "@/model/schema";
import { adjustH, type HProposal, type HResult } from "../adjustH";

const STRAIGHT: FunctionRef = { kind: "builtin", id: "straight-line" };
const MANHATTAN: FunctionRef = { kind: "builtin", id: "manhattan" };
const user = (source: string): FunctionRef => ({ kind: "user", name: "custom", source });

/** A(0,0) with edges to B(0,100) and C(100,0); goal G(400,0) joined to C; Z(0,300) has no edges. */
function setup(heuristic: FunctionRef): { graph: StateSpaceGraph; problem: Problem } {
  const pos: [string, number, number][] = [
    ["A", 0, 0],
    ["B", 0, 100],
    ["C", 100, 0],
    ["G", 400, 0],
    ["Z", 0, 300],
  ];
  const graph: StateSpaceGraph = {
    version: 1,
    id: "t",
    name: "t",
    pxPerUnit: 100,
    costModel: { kind: "builtin", id: "euclidean" },
    nodes: pos.map(([id, x, y]) => ({ id, name: id, x, y })),
    edges: [
      ["A", "B"],
      ["A", "C"],
      ["C", "G"],
    ].map(([from, to]) => ({ id: from + to, from, to, directed: false, friction: 1 })),
  };
  const problem: Problem = { version: 1, id: "p", name: "p", graphId: "t", initial: "A", goal: "G", heuristic, manualH: {} };
  return { graph, problem };
}

function moved(graph: StateSpaceGraph, nodeId: string, p: HProposal): StateSpaceGraph {
  return { ...graph, nodes: graph.nodes.map((n) => (n.id === nodeId ? { ...n, ...p.position } : n)) };
}

const hOf = (graph: StateSpaceGraph, problem: Problem, id: string) =>
  computeHeuristicTable(graph, problem, evaluateGraph(graph)).values[id]!;

const dist = (g: StateSpaceGraph, a: string, b: string) => {
  const p = g.nodes.find((n) => n.id === a)!;
  const q = g.nodes.find((n) => n.id === b)!;
  return Math.hypot(p.x - q.x, p.y - q.y);
};

/** Every proposal reaches the target (checked independently with the h table) and keeps its edge. */
function expectSolved(res: HResult, graph: StateSpaceGraph, problem: Problem, nodeId: string, target: number) {
  if (!res.ok) throw new Error(`expected proposals, got ${JSON.stringify(res)}`);
  for (const p of res.proposals) {
    const g = moved(graph, nodeId, p);
    expect(hOf(g, problem, nodeId)).toBeCloseTo(target, 7);
    if (p.move.kind === "keep") expect(dist(g, nodeId, p.move.pivot!.id)).toBeCloseTo(dist(graph, nodeId, p.move.pivot!.id), 9);
  }
  return res.proposals;
}

describe("adjustH", () => {
  it("rotates about the kept edge's other end for the straight-line heuristic", () => {
    const { graph, problem } = setup(STRAIGHT);
    const res = adjustH(graph, problem, "A", 3.5, { kind: "keep", edgeId: "AC" });
    const ps = expectSolved(res, graph, problem, "A", 3.5);
    // |P − C| = 100 and |P − G| = 350 meet at cos θ = −0.375: two mirror images.
    expect(ps).toHaveLength(2);
    for (const p of ps) {
      expect(p.position.x).toBeCloseTo(62.5, 6);
      expect(Math.abs(p.position.y)).toBeCloseTo(100 * Math.sqrt(1 - 0.375 ** 2), 6);
      expect(p.motion).toMatch(/^A rotates 68\.0° (counter-)?clockwise about C$/);
      expect(p.changed.map((c) => c.edgeIds[0])).toEqual(["AB"]);
    }
  });

  it("works for the Manhattan heuristic, and reports its range when out of reach", () => {
    const { graph, problem } = setup(MANHATTAN);
    expectSolved(adjustH(graph, problem, "A", 4.2, { kind: "keep", edgeId: "AC" }), graph, problem, "A", 4.2);
    // On the circle around C, h = 3 − cos θ + |sin θ|, whose maximum is 3 + √2.
    const far = adjustH(graph, problem, "A", 4.5, { kind: "keep", edgeId: "AC" });
    if (far.ok || far.reason !== "range") throw new Error(JSON.stringify(far));
    expect(far.max).toBeCloseTo(3 + Math.SQRT2, 6);
    expect(far.closest?.h).toBeCloseTo(3 + Math.SQRT2, 6);
  });

  it("works for user-defined heuristics, including ones that read costs from ctx.actions", () => {
    let { graph, problem } = setup(user("return ctx.euclidean(node, ctx.goal) + node.y / 100;"));
    expectSolved(adjustH(graph, problem, "A", 3.7, { kind: "keep", edgeId: "AC" }), graph, problem, "A", 3.7);

    ({ graph, problem } = setup(
      user("return Math.min(...ctx.actions[node.id].map((a) => a.cost)) + ctx.euclidean(node, ctx.goal);"),
    ));
    expect(hOf(graph, problem, "A")).toBeCloseTo(5, 9);
    expectSolved(adjustH(graph, problem, "A", 4.6, { kind: "keep", edgeId: "AC" }), graph, problem, "A", 4.6);
  });

  it("moves a state without edges straight towards the goal", () => {
    const { graph, problem } = setup(STRAIGHT);
    const ps = expectSolved(adjustH(graph, problem, "Z", 4), graph, problem, "Z", 4);
    expect(ps[0].move.kind).toBe("free");
    expect(ps[0].position.x).toBeCloseTo(80, 6);
    expect(ps[0].position.y).toBeCloseTo(240, 6);
    expect(ps[0].distance).toBeCloseTo(1, 6);
  });

  it("prefers keeping edges whose length was set earlier", () => {
    const { graph, problem } = setup(STRAIGHT);
    for (const keep of ["AB", "AC"]) {
      const ps = expectSolved(adjustH(graph, problem, "A", 3.5, { kind: "any" }, { protectedEdges: [keep] }), graph, problem, "A", 3.5);
      expect(ps[0].move.kept?.edgeIds).toEqual([keep]);
      expect(ps.some((p) => p.move.kind === "free")).toBe(true);
    }
  });

  it("ignores positions where the heuristic fails", () => {
    const { graph, problem } = setup(user('if (node.y > 0) throw new Error("no"); return ctx.euclidean(node, ctx.goal);'));
    const ps = expectSolved(adjustH(graph, problem, "A", 3.5, { kind: "keep", edgeId: "AC" }), graph, problem, "A", 3.5);
    expect(ps).toHaveLength(1);
    expect(ps[0].position.y).toBeLessThan(0);
  });

  it("lists other states whose h changes", () => {
    const { graph, problem } = setup(
      user('return ctx.euclidean(node, ctx.goal) + (node.id === "B" ? ctx.euclidean(ctx.nodeById.get("A"), ctx.goal) : 0);'),
    );
    const ps = expectSolved(adjustH(graph, problem, "A", 3.5, { kind: "keep", edgeId: "AC" }), graph, problem, "A", 3.5);
    expect(ps[0].hChanges.map((c) => c.id)).toEqual(["B"]);
    expect(ps[0].hChanges[0].after).toBeCloseTo(hOf(graph, problem, "B") - 0.5, 6);
  });

  it("explains what can't be done", () => {
    const { graph, problem } = setup(STRAIGHT);
    const reason = (r: HResult) => (r.ok ? "ok" : r.reason);
    expect(reason(adjustH(graph, problem, "G", 1))).toBe("invalid");
    expect(reason(adjustH(graph, problem, "A", 4))).toBe("invalid"); // already 4
    expect(reason(adjustH(graph, { ...problem, goal: null }, "A", 3))).toBe("invalid");
    expect(reason(adjustH(graph, { ...problem, heuristic: { kind: "builtin", id: "manual" } }, "A", 3))).toBe("invalid");
    expect(reason(adjustH(graph, { ...problem, heuristic: user("return 7;") }, "A", 3))).toBe("constant");
  });

  it("stays fast on a larger graph", () => {
    const { graph, problem } = setup(STRAIGHT);
    const nodes = [...graph.nodes];
    const edges = [...graph.edges];
    for (let i = 0; i < 150; i++) {
      nodes.push({ id: `n${i}`, name: `n${i}`, x: 500 + (i % 15) * 60, y: Math.floor(i / 15) * 60 });
      if (i > 0) edges.push({ id: `e${i}`, from: `n${i - 1}`, to: `n${i}`, directed: false, friction: 1 });
    }
    const big = { ...graph, nodes, edges };
    const res = adjustH(big, problem, "A", 3.5);
    expectSolved(res, big, problem, "A", 3.5);
    expect(res.ok && res.stats.ms).toBeLessThan(1000);
  });
});
