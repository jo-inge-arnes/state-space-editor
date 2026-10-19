import { describe, expect, it } from "vitest";
import type { StateSpaceGraph } from "@/model/schema";
import { sampleState } from "@/state/editorReducer";
import { adjustEdgeLength, potentiallyAffected, type AdjustResult, type Proposal } from "../adjustLength";
import { PebbleGame } from "../pebbleGame";
import { blocksOf, buildStructure } from "../structure";

/** Graph with node ids = names; edge ids are the two names joined ("AB"). */
function graph(nodes: [string, number, number][], edges: [string, string, boolean?][], pxPerUnit = 100): StateSpaceGraph {
  return {
    version: 1,
    id: "t",
    name: "t",
    pxPerUnit,
    costModel: { kind: "builtin", id: "euclidean" },
    nodes: nodes.map(([name, x, y]) => ({ id: name, name, x, y })),
    edges: edges.map(([from, to, directed = false]) => ({ id: from + to, from, to, directed, friction: 1 })),
  };
}

function lengthOf(g: StateSpaceGraph, edgeId: string): number {
  const e = g.edges.find((x) => x.id === edgeId)!;
  const a = g.nodes.find((n) => n.id === e.from)!;
  const b = g.nodes.find((n) => n.id === e.to)!;
  return Math.hypot(a.x - b.x, a.y - b.y) / g.pxPerUnit;
}

function applied(g: StateSpaceGraph, p: Proposal): StateSpaceGraph {
  return { ...g, nodes: g.nodes.map((n) => (p.positions[n.id] ? { ...n, ...p.positions[n.id] } : n)) };
}

/** Every proposal hits the target, and only its listed edges (never locked ones) change. */
function expectValid(g: StateSpaceGraph, res: AdjustResult, edgeId: string, target: number, locked: string[] = []) {
  if (!res.ok) throw new Error(`expected a solution, got ${JSON.stringify(res)}`);
  expect(res.proposals.length).toBeGreaterThan(0);
  const twin = (id: string) => {
    const e = g.edges.find((x) => x.id === id)!;
    const t = g.edges.find((x) => x.id === edgeId)!;
    return (e.from === t.from && e.to === t.to) || (e.from === t.to && e.to === t.from);
  };
  for (const p of res.proposals) {
    const h = applied(g, p);
    expect(lengthOf(h, edgeId)).toBeCloseTo(target, 6);
    const changed = new Set(p.changed.flatMap((c) => c.edgeIds));
    for (const e of g.edges) {
      if (twin(e.id)) continue;
      if (!changed.has(e.id)) expect(lengthOf(h, e.id)).toBeCloseTo(lengthOf(g, e.id), 6);
      if (locked.includes(e.id)) expect(changed.has(e.id)).toBe(false);
    }
  }
  return res;
}

describe("pebble game", () => {
  const run = (n: number, pairs: [number, number][]) => {
    const bars = pairs.map(([u, v]) => ({ u, v }));
    const game = new PebbleGame(n, bars);
    return { game, accepted: bars.map((_, i) => game.add(i)) };
  };

  it("finds the redundant bar of K4 and accepts K4 minus an edge", () => {
    const k4: [number, number][] = [[0, 1], [0, 2], [0, 3], [1, 2], [1, 3], [2, 3]];
    expect(run(4, k4).accepted.filter((x) => !x)).toHaveLength(1);
    expect(run(4, k4.slice(1)).accepted.every(Boolean)).toBe(true);
    // In K4 minus 0–1 the pair (0, 1) is still rigid; in a 4-cycle it is not.
    expect(run(4, k4.slice(1)).game.isFlexiblePair(0, 1)).toBe(false);
    expect(run(4, [[0, 2], [2, 1], [1, 3], [3, 0]]).game.isFlexiblePair(0, 1)).toBe(true);
  });

  it("accepts 2n − 3 bars of a Laman graph and rejects every extra bar", () => {
    // Henneberg construction: each new node is attached by two bars, so the graph is minimally rigid.
    const pairs: [number, number][] = [[0, 1]];
    for (let v = 2; v < 30; v++) pairs.push([v, v - 1], [v, (v * 5) % (v - 1)]);
    const extras: [number, number][] = [[0, 29], [3, 17], [5, 23], [8, 11], [2, 28]];
    const { accepted } = run(30, [...pairs, ...extras]);
    expect(accepted.slice(0, pairs.length).every(Boolean)).toBe(true);
    expect(accepted.slice(pairs.length).some(Boolean)).toBe(false);
  });
});

describe("structure", () => {
  it("splits bars into biconnected blocks", () => {
    const g = graph(
      [["A", 0, 0], ["B", 100, 0], ["C", 50, 80], ["D", 150, 80], ["E", 250, 80], ["F", 200, 160]],
      [["A", "B"], ["B", "C"], ["C", "A"], ["C", "D"], ["D", "E"], ["E", "F"], ["F", "D"]],
    );
    const s = buildStructure(g);
    const block = blocksOf(s);
    const of = (id: string) => block[s.barOfEdge.get(id)!];
    expect(of("AB")).toBe(of("BC"));
    expect(of("AB")).toBe(of("CA"));
    expect(of("DE")).toBe(of("FD"));
    expect(new Set([of("AB"), of("CD"), of("DE")]).size).toBe(3);
    expect(potentiallyAffected(g, "CD")).toEqual([]);
    expect(potentiallyAffected(g, "AB").map((b) => b.edgeIds[0]).sort()).toEqual(["BC", "CA"]);
  });
});

describe("adjustEdgeLength", () => {
  it("moves a leaf along its edge", () => {
    const g = graph([["A", 0, 0], ["B", 100, 0], ["C", 100, 100]], [["A", "B"], ["B", "C"]]);
    const res = expectValid(g, adjustEdgeLength(g, "AB", 2), "AB", 2);
    const best = res.proposals[0];
    expect(best.changed).toEqual([]);
    expect(best.moved.map((m) => m.id)).toEqual(["A"]);
    expect(best.positions.A.x).toBeCloseTo(-100, 6);
    expect(best.positions.A.y).toBeCloseTo(0, 6);
  });

  it("rotates one corner of a triangle about the opposite corner", () => {
    const g = graph([["A", 0, 0], ["B", 300, 0], ["C", 150, 200]], [["A", "B"], ["B", "C"], ["C", "A"]]);
    const res = expectValid(g, adjustEdgeLength(g, "AB", 2.5), "AB", 2.5);
    const best = res.proposals[0];
    expect(best.changed).toEqual([]);
    expect(best.moved).toHaveLength(1);
    expect(best.motions[0]).toMatch(/rotates [\d.]+° (counter-)?clockwise about C/);
  });

  it("changes one more edge when the triangle inequality forbids the target", () => {
    const g = graph([["A", 0, 0], ["B", 300, 0], ["C", 150, 200]], [["A", "B"], ["B", "C"], ["C", "A"]]);
    const res = expectValid(g, adjustEdgeLength(g, "AB", 6), "AB", 6);
    expect(res.ok && res.proposals[0].changed).toHaveLength(1);
    // Without extra changes the longest reachable length is |AC| + |CB| = 5.
    expect(res.ok && res.reachable?.changes).toBe(0);
    expect(res.ok && res.reachable!.length).toBeGreaterThan(4.95);
    expect(res.ok && res.reachable!.length).toBeLessThanOrEqual(5 + 1e-9);
  });

  it("moves only A in the example graph (rotating about C)", () => {
    const { graph: g } = sampleState();
    const res = expectValid(g, adjustEdgeLength(g, "e1", 3), "e1", 3);
    const best = res.proposals[0];
    expect(res.ok && res.minimal).toBe(true);
    expect(best.changed).toEqual([]);
    expect(best.moved.map((m) => m.name)).toEqual(["A"]);
    expect(best.motions[0]).toMatch(/^A rotates .* about C$/);
    // The least-total-movement alternative is offered as well.
    expect(res.ok && res.proposals.some((p) => p.kind === "least-movement")).toBe(true);
  });

  it("keeps the chosen end fixed", () => {
    const { graph: g } = sampleState();
    const res = expectValid(g, adjustEdgeLength(g, "e1", 3, { keepFixed: "from" }), "e1", 3);
    for (const p of res.ok ? res.proposals : []) expect(p.positions.n1).toBeUndefined();
  });

  it("needs no extra change in two triangles sharing a chord", () => {
    const g = graph(
      [["A", 0, 0], ["B", 200, -100], ["C", 300, 100], ["D", 100, 200]],
      [["A", "B"], ["B", "C"], ["C", "D"], ["D", "A"], ["A", "C"]],
    );
    const res = expectValid(g, adjustEdgeLength(g, "AB", 2), "AB", 2);
    expect(res.ok && res.proposals[0].changed).toEqual([]);
    expect(res.ok && res.proposals[0].moved.map((m) => m.id)).toEqual(["B"]);
  });

  it("changes exactly one other edge of K4 and of a wheel", () => {
    const k4 = graph(
      [["A", 0, 0], ["B", 300, 0], ["C", 150, 250], ["D", 150, 90]],
      [["A", "B"], ["A", "C"], ["A", "D"], ["B", "C"], ["B", "D"], ["C", "D"]],
    );
    const res = expectValid(k4, adjustEdgeLength(k4, "AB", 3.3), "AB", 3.3);
    expect(res.ok && res.minimal).toBe(true);
    expect(res.ok && res.proposals[0].changed).toHaveLength(1);

    const rim = [0, 1, 2, 3, 4].map((i): [string, number, number] => [
      `R${i}`,
      200 * Math.cos((2 * Math.PI * i) / 5),
      200 * Math.sin((2 * Math.PI * i) / 5),
    ]);
    const wheel = graph(
      [["H", 0, 0], ...rim],
      [...rim.map(([r]): [string, string] => ["H", r]), ...rim.map(([r], i): [string, string] => [r, rim[(i + 1) % 5][0]])],
    );
    const w = expectValid(wheel, adjustEdgeLength(wheel, "HR0", 2.4), "HR0", 2.4);
    expect(w.ok && w.proposals[0].changed).toHaveLength(1);
  });

  it("reports locked edges that make the change impossible", () => {
    const k4 = graph(
      [["A", 0, 0], ["B", 300, 0], ["C", 150, 250], ["D", 150, 90]],
      [["A", "B"], ["A", "C"], ["A", "D"], ["B", "C"], ["B", "D"], ["C", "D"]],
    );
    const res = adjustEdgeLength(k4, "AB", 3.3, { locked: ["AC", "AD", "BC", "BD", "CD"] });
    expect(res.ok).toBe(false);
    expect(!res.ok && res.reason).toBe("locked");
    expect(!res.ok && res.reason === "locked" && res.blocking.length).toBeGreaterThan(0);
    // Unlocking one edge is enough, and that is the edge that changes.
    const one = adjustEdgeLength(k4, "AB", 3.3, { locked: ["AC", "AD", "BC", "BD"] });
    expectValid(k4, one, "AB", 3.3, ["AC", "AD", "BC", "BD"]);
    expect(one.ok && one.proposals[0].changed.map((c) => c.edgeIds[0])).toEqual(["CD"]);
  });

  it("stretches a 4-cycle past its reach by changing one more edge", () => {
    const g = graph(
      [["A", 0, 0], ["B", 100, 0], ["C", 100, 100], ["D", 0, 100]],
      [["A", "B"], ["B", "C"], ["C", "D"], ["D", "A"]],
    );
    const flex = expectValid(g, adjustEdgeLength(g, "AB", 2), "AB", 2);
    expect(flex.ok && flex.proposals[0].changed).toEqual([]);
    const far = expectValid(g, adjustEdgeLength(g, "AB", 3.5), "AB", 3.5);
    expect(far.ok && far.proposals[0].changed).toHaveLength(1);
    expect(far.ok && far.reachable!.length).toBeGreaterThan(2.9);
  });

  it("bends collinear states when shortening, but must change an edge to lengthen", () => {
    const g = graph([["A", 0, 0], ["C", 100, 0], ["B", 200, 0]], [["A", "C"], ["C", "B"], ["A", "B"]]);
    const shorter = expectValid(g, adjustEdgeLength(g, "AB", 1.5), "AB", 1.5);
    expect(shorter.ok && shorter.proposals[0].changed).toEqual([]);
    const longer = expectValid(g, adjustEdgeLength(g, "AB", 2.5), "AB", 2.5);
    expect(longer.ok && longer.proposals[0].changed).toHaveLength(1);
  });

  it("changes the opposite one-way edge together with the edited one", () => {
    const g = graph(
      [["A", 0, 0], ["B", 300, 0], ["C", 150, 200]],
      [["A", "B", true], ["B", "A", true], ["B", "C"], ["C", "A"]],
    );
    const res = expectValid(g, adjustEdgeLength(g, "AB", 2.5), "AB", 2.5);
    const best = res.ok ? res.proposals[0] : null;
    expect(best?.changed).toEqual([]);
    expect(lengthOf(applied(g, best!), "BA")).toBeCloseTo(2.5, 6);
  });

  it("rejects invalid targets", () => {
    const { graph: g } = sampleState();
    expect(adjustEdgeLength(g, "e1", -1).ok).toBe(false);
    expect(adjustEdgeLength(g, "nope", 2).ok).toBe(false);
  });

  it("handles a dense triangulated 14×14 grid quickly", () => {
    const N = 14;
    const nodes: [string, number, number][] = [];
    const edges: [string, string][] = [];
    const id = (i: number, j: number) => `n${i}_${j}`;
    for (let i = 0; i < N; i++)
      for (let j = 0; j < N; j++) {
        nodes.push([id(i, j), 60 * i + (j % 2) * 7, 60 * j + (i % 3) * 5]);
        if (i + 1 < N) edges.push([id(i, j), id(i + 1, j)]);
        if (j + 1 < N) edges.push([id(i, j), id(i, j + 1)]);
        if (i + 1 < N && j + 1 < N) edges.push([id(i, j), id(i + 1, j + 1)]);
      }
    const g = graph(nodes, edges);
    const edgeId = id(6, 6) + id(7, 6);
    const res = adjustEdgeLength(g, edgeId, 0.8);
    expectValid(g, res, edgeId, 0.8);
    expect(res.ok && res.stats.ms).toBeLessThan(3000);
  });
});
