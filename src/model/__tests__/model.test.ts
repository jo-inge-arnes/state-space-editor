import { describe, expect, it } from "vitest";
import { evaluateGraph } from "../actions";
import { computeHeuristicTable } from "../heuristics/registry";
import type { Edge, Problem, StateSpaceGraph } from "../schema";
import { parseGraph, parseProblem, toGraphDocument, toProblemDocument } from "../serialize";

function graph(overrides: Partial<StateSpaceGraph> = {}, edges: Partial<Edge>[] = []): StateSpaceGraph {
  return {
    version: 1,
    id: "g",
    name: "G",
    pxPerUnit: 100,
    costModel: { kind: "builtin", id: "euclidean" },
    nodes: [
      { id: "a", name: "A", x: 0, y: 0 },
      { id: "b", name: "B", x: 300, y: 0 },
      { id: "c", name: "C", x: 300, y: 400 },
    ],
    edges: edges.map((e, i) => ({ id: `e${i}`, from: "a", to: "b", directed: false, friction: 1, ...e })),
    ...overrides,
  };
}

function problem(overrides: Partial<Problem> = {}): Problem {
  return {
    version: 1,
    id: "p",
    name: "P",
    graphId: "g",
    initial: "a",
    goal: "c",
    heuristic: { kind: "builtin", id: "straight-line" },
    manualH: {},
    hOverrides: {},
    ...overrides,
  };
}

describe("cost models", () => {
  it("scales Euclidean length by pxPerUnit and friction", () => {
    const ev = evaluateGraph(graph({}, [{ friction: 1.5 }]));
    expect(ev.edges.e0.length).toBeCloseTo(3);
    expect(ev.edges.e0.forward.cost).toBeCloseTo(4.5);
    expect(ev.edges.e0.backward?.cost).toBeCloseTo(4.5);
  });

  it("uses manual costs in manual mode and reports missing ones", () => {
    const ev = evaluateGraph(
      graph({ costModel: { kind: "builtin", id: "manual" } }, [{ manualCost: 7 }, { from: "b", to: "c" }]),
    );
    expect(ev.edges.e0.forward.cost).toBe(7);
    expect(ev.edges.e1.forward.cost).toBeNull();
    expect(ev.edges.e1.forward.error).toMatch(/manual cost/);
    expect(ev.failedActions).toBe(2);
  });

  it("runs user-defined cost functions and validates their results", () => {
    const user = (source: string) =>
      evaluateGraph(graph({ costModel: { kind: "user", name: "u", source } }, [{ directed: true }]));
    expect(user("return ctx.euclidean(from, to) + 1;").edges.e0.forward.cost).toBeCloseTo(4);
    expect(user("return -1;").edges.e0.forward.error).toMatch(/≥ 0/);
    expect(user("return NaN;").edges.e0.forward.error).toMatch(/finite/);
    expect(user("throw new Error('boom');").edges.e0.forward.error).toBe("boom");
    expect(user("return (;").costModelError).toMatch(/Compile error/);
  });
});

describe("actions", () => {
  it("creates one action for directed and two for undirected edges", () => {
    const ev = evaluateGraph(graph({}, [{ directed: true }, { from: "b", to: "c" }]));
    expect(ev.actions.a.map((x) => x.name)).toEqual(["go(B)"]);
    expect(ev.actions.b.map((x) => x.name)).toEqual(["go(C)"]);
    expect(ev.actions.c.map((x) => x.name)).toEqual(["go(B)"]);
  });
});

describe("heuristics", () => {
  const g = graph({}, [{}, { from: "b", to: "c" }]);
  const ev = evaluateGraph(g);

  it("computes straight-line distance in the same units as the costs", () => {
    const t = computeHeuristicTable(g, problem(), ev);
    expect(t.values.a).toBeCloseTo(5); // 3-4-5 triangle: 500 px / 100
    expect(t.values.b).toBeCloseTo(4);
    expect(t.values.c).toBe(0);
  });

  it("is interchangeable with other built-in and user heuristics", () => {
    expect(computeHeuristicTable(g, problem({ heuristic: { kind: "builtin", id: "zero" } }), ev).values.a).toBe(0);
    expect(computeHeuristicTable(g, problem({ heuristic: { kind: "builtin", id: "manhattan" } }), ev).values.a).toBeCloseTo(7);
    const manual = problem({ heuristic: { kind: "builtin", id: "manual" }, manualH: { a: 2 } });
    expect(computeHeuristicTable(g, manual, ev).values).toEqual({ a: 2, b: 0, c: 0 });
    const user = problem({ heuristic: { kind: "user", name: "half", source: "return ctx.euclidean(node, ctx.goal) / 2;" } });
    expect(computeHeuristicTable(g, user, ev).values.a).toBeCloseTo(2.5);
  });

  it("lets typed-in values override any heuristic, including where it fails", () => {
    const failsAtB = { kind: "user" as const, name: "f", source: 'if (node.id === "b") throw new Error("no"); return 1;' };
    for (const heuristic of [problem().heuristic, failsAtB]) {
      const t = computeHeuristicTable(g, problem({ heuristic, hOverrides: { a: 9, b: 2.5 } }), ev);
      expect(t.values).toMatchObject({ a: 9, b: 2.5 });
      expect(t.errors).toEqual({});
    }
    const t = computeHeuristicTable(g, problem({ hOverrides: { a: 9 } }), ev);
    expect(t.overridden).toEqual({ a: expect.closeTo(5) });
    // Overrides are part of the problem file and of its derived h table.
    const doc = toProblemDocument(problem({ hOverrides: { a: 9 } }), g, { evaluated: ev });
    expect(doc.derived?.h.a).toBe(9);
    const back = parseProblem(JSON.parse(JSON.stringify(doc)));
    expect(back.ok && back.value.problem.hOverrides).toEqual({ a: 9 });
    // Older files without the field still load.
    const old: Partial<typeof doc> = { ...doc };
    delete old.hOverrides;
    const parsedOld = parseProblem(old);
    expect(parsedOld.ok && parsedOld.value.problem.hOverrides).toEqual({});
  });

  it("requires a goal", () => {
    expect(computeHeuristicTable(g, problem({ goal: null }), ev).error).toMatch(/goal/);
  });
});

describe("serialization", () => {
  it("round-trips a graph and includes derived costs and actions", () => {
    const g = graph({}, [{ friction: 2 }]);
    const doc = JSON.parse(JSON.stringify(toGraphDocument(g)));
    expect(doc.derived.edges[0]).toMatchObject({ id: "e0", length: 3, cost: 6, reverseCost: 6 });
    expect(doc.derived.actions.a).toEqual([{ action: "go(B)", to: "b", cost: 6 }]);
    const back = parseGraph(JSON.stringify(doc));
    expect(back).toEqual({ ok: true, value: g });
  });

  it("round-trips a problem with an embedded graph", () => {
    const g = graph({}, [{}, { from: "b", to: "c" }]);
    const p = problem();
    const doc = JSON.parse(JSON.stringify(toProblemDocument(p, g, { embedGraph: true })));
    expect(doc.derived.h.a).toBeCloseTo(5);
    expect(doc.derived).not.toHaveProperty("hStar");
    const back = parseProblem(JSON.stringify(doc));
    expect(back).toEqual({ ok: true, value: { problem: p, graph: g } });
  });

  it("rejects invalid documents", () => {
    expect(parseGraph("{").ok).toBe(false);
    const dangling = parseGraph({ ...graph(), edges: [{ id: "x", from: "a", to: "zzz", directed: false, friction: 1 }] });
    expect(dangling.ok || dangling.error).toMatch(/missing node/);
    expect(parseGraph({ ...graph(), id: "../etc" }).ok).toBe(false);
    expect(parseGraph({ ...graph(), edges: [{ id: "x", from: "a", to: "b", friction: 0.5 }] }).ok).toBe(false);
  });
});
