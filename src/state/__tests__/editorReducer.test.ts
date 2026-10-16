import { describe, expect, it } from "vitest";
import { editorReducer, initialEditorState, sampleState, type EditorState } from "../editorReducer";

function start(): EditorState {
  const { graph, problem } = sampleState();
  return initialEditorState(graph, problem);
}

describe("editorReducer", () => {
  it("adds nodes with unique ids and names", () => {
    let s = initialEditorState({ ...sampleState().graph, nodes: [], edges: [] });
    s = editorReducer(s, { type: "addNode", x: 0, y: 0 });
    s = editorReducer(s, { type: "addNode", x: 10, y: 0 });
    expect(s.graph.nodes.map((n) => [n.id, n.name])).toEqual([
      ["n1", "S1"],
      ["n2", "S2"],
    ]);
  });

  it("does not duplicate edges between the same pair", () => {
    let s = start();
    const before = s.graph.edges.length;
    s = editorReducer(s, { type: "addEdge", from: "n2", to: "n1" }); // e1 is n1–n2, undirected
    expect(s.graph.edges.length).toBe(before);
    expect(s.selection).toEqual({ kind: "edge", id: "e1" });
  });

  it("allows opposite one-way edges", () => {
    let s = start();
    s = editorReducer(s, { type: "updateEdge", id: "e1", patch: { directed: true } });
    s = editorReducer(s, { type: "addEdge", from: "n2", to: "n1" });
    const added = s.graph.edges.at(-1)!;
    expect(added).toMatchObject({ from: "n2", to: "n1", directed: true });
    // and the pair can't be made undirected any more
    const blocked = editorReducer(s, { type: "updateEdge", id: added.id, patch: { directed: false } });
    expect(blocked).toBe(s);
  });

  it("clamps friction to ≥ 1 and rejects duplicate names", () => {
    let s = start();
    s = editorReducer(s, { type: "updateEdge", id: "e1", patch: { friction: 0.2 } });
    expect(s.graph.edges[0].friction).toBe(1);
    expect(editorReducer(s, { type: "renameNode", id: "n1", name: "B" })).toBe(s);
  });

  it("removes edges and problem references when deleting a node", () => {
    let s = start();
    s = editorReducer(s, { type: "deleteNode", id: "n6" });
    expect(s.graph.edges.some((e) => e.from === "n6" || e.to === "n6")).toBe(false);
    expect(s.problem.goal).toBeNull();
  });

  it("prefills manual costs when switching to the manual cost model", () => {
    let s = start();
    s = editorReducer(s, { type: "setCostModel", ref: { kind: "builtin", id: "manual" } });
    expect(s.graph.edges.every((e) => typeof e.manualCost === "number" && e.manualCost > 0)).toBe(true);
  });
});
