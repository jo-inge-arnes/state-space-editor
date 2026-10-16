import { evaluateGraph } from "@/model/actions";
import { euclidean } from "@/model/geometry";
import type { Edge, FunctionRef, Problem, StateNode, StateSpaceGraph } from "@/model/schema";

export type Mode = "select" | "add-node" | "add-edge";
export type Selection = { kind: "node"; id: string } | { kind: "edge"; id: string } | null;

export interface EditorState {
  graph: StateSpaceGraph;
  problem: Problem;
  selection: Selection;
  mode: Mode;
  /** Source node while creating an edge in add-edge mode. */
  pendingEdgeFrom: string | null;
  /** True when there are changes not saved to the server or a file. */
  dirty: boolean;
}

export type EditorAction =
  | { type: "addNode"; x: number; y: number }
  | { type: "moveNode"; id: string; x: number; y: number }
  | { type: "renameNode"; id: string; name: string }
  | { type: "deleteNode"; id: string }
  | { type: "addEdge"; from: string; to: string }
  | { type: "updateEdge"; id: string; patch: Partial<Omit<Edge, "id" | "from" | "to">> }
  | { type: "reverseEdge"; id: string }
  | { type: "deleteEdge"; id: string }
  | { type: "deleteSelection" }
  | { type: "select"; selection: Selection }
  | { type: "setMode"; mode: Mode }
  | { type: "setPendingEdge"; from: string | null }
  | { type: "setGraphMeta"; patch: Partial<Pick<StateSpaceGraph, "name" | "id" | "pxPerUnit">> }
  | { type: "setCostModel"; ref: FunctionRef }
  | { type: "setProblem"; patch: Partial<Pick<Problem, "name" | "id" | "initial" | "goal" | "heuristic">> }
  | { type: "setManualH"; nodeId: string; value: number | null }
  | { type: "load"; graph: StateSpaceGraph; problem?: Problem; dirty?: boolean }
  | { type: "loadProblem"; problem: Problem }
  | { type: "markSaved" }
  | { type: "new" };

export const DEFAULT_PX_PER_UNIT = 100;

/** Smallest "<prefix><n>" not already in `taken`. */
export function nextFreeLabel(prefix: string, taken: Iterable<string>): string {
  const used = new Set(taken);
  for (let i = 1; ; i++) if (!used.has(`${prefix}${i}`)) return `${prefix}${i}`;
}

export function emptyProblem(graph: StateSpaceGraph): Problem {
  return {
    version: 1,
    id: `${graph.id}-problem`,
    name: `${graph.name} problem`,
    graphId: graph.id,
    initial: null,
    goal: null,
    heuristic: { kind: "builtin", id: "straight-line" },
    manualH: {},
  };
}

export function emptyGraph(): StateSpaceGraph {
  return {
    version: 1,
    id: "untitled",
    name: "Untitled",
    pxPerUnit: DEFAULT_PX_PER_UNIT,
    costModel: { kind: "builtin", id: "euclidean" },
    nodes: [],
    edges: [],
  };
}

/** Small example graph shown on first visit. */
export function sampleState(): { graph: StateSpaceGraph; problem: Problem } {
  const pos: [string, number, number][] = [
    ["A", 120, 300],
    ["B", 320, 140],
    ["C", 340, 420],
    ["D", 560, 260],
    ["E", 760, 120],
    ["F", 820, 380],
  ];
  const nodes: StateNode[] = pos.map(([name, x, y], i) => ({ id: `n${i + 1}`, name, x, y }));
  const pairs: [number, number, number?][] = [
    [1, 2],
    [1, 3],
    [2, 4],
    [3, 4, 1.5],
    [2, 5],
    [4, 6],
    [5, 6],
  ];
  const edges: Edge[] = pairs.map(([a, b, friction = 1], i) => ({
    id: `e${i + 1}`,
    from: `n${a}`,
    to: `n${b}`,
    directed: false,
    friction,
  }));
  const graph: StateSpaceGraph = { ...emptyGraph(), id: "example", name: "Example", nodes, edges };
  return { graph, problem: { ...emptyProblem(graph), initial: "n1", goal: "n6" } };
}

export function initialEditorState(graph: StateSpaceGraph, problem?: Problem): EditorState {
  return {
    graph,
    problem: problem ?? emptyProblem(graph),
    selection: null,
    mode: "select",
    pendingEdgeFrom: null,
    dirty: false,
  };
}

/** Drop problem references to nodes that no longer exist. */
function pruneProblem(problem: Problem, graph: StateSpaceGraph): Problem {
  const ids = new Set(graph.nodes.map((n) => n.id));
  const manualH = Object.fromEntries(Object.entries(problem.manualH).filter(([id]) => ids.has(id)));
  return {
    ...problem,
    graphId: graph.id,
    initial: problem.initial && ids.has(problem.initial) ? problem.initial : null,
    goal: problem.goal && ids.has(problem.goal) ? problem.goal : null,
    manualH,
  };
}

function withGraph(state: EditorState, graph: StateSpaceGraph): EditorState {
  return { ...state, graph, problem: pruneProblem(state.problem, graph), dirty: true };
}

function removeNode(state: EditorState, id: string): EditorState {
  const graph = {
    ...state.graph,
    nodes: state.graph.nodes.filter((n) => n.id !== id),
    edges: state.graph.edges.filter((e) => e.from !== id && e.to !== id),
  };
  return { ...withGraph(state, graph), selection: null, pendingEdgeFrom: null };
}

function removeEdge(state: EditorState, id: string): EditorState {
  const graph = { ...state.graph, edges: state.graph.edges.filter((e) => e.id !== id) };
  return { ...withGraph(state, graph), selection: null };
}

export function editorReducer(state: EditorState, action: EditorAction): EditorState {
  const { graph } = state;
  switch (action.type) {
    case "addNode": {
      const node: StateNode = {
        id: nextFreeLabel("n", graph.nodes.map((n) => n.id)),
        name: nextFreeLabel("S", graph.nodes.map((n) => n.name)),
        x: action.x,
        y: action.y,
      };
      return {
        ...withGraph(state, { ...graph, nodes: [...graph.nodes, node] }),
        selection: { kind: "node", id: node.id },
      };
    }
    case "moveNode":
      return withGraph(state, {
        ...graph,
        nodes: graph.nodes.map((n) => (n.id === action.id ? { ...n, x: action.x, y: action.y } : n)),
      });
    case "renameNode": {
      const name = action.name.trim();
      if (!name || graph.nodes.some((n) => n.id !== action.id && n.name === name)) return state;
      return withGraph(state, {
        ...graph,
        nodes: graph.nodes.map((n) => (n.id === action.id ? { ...n, name } : n)),
      });
    }
    case "deleteNode":
      return removeNode(state, action.id);
    case "addEdge": {
      const { from, to } = action;
      if (from === to) return { ...state, pendingEdgeFrom: null };
      // Same pair already connected: select the existing edge instead of duplicating it.
      const existing = graph.edges.find(
        (e) => (e.from === from && e.to === to) || (e.from === to && e.to === from && !e.directed),
      );
      if (existing) return { ...state, selection: { kind: "edge", id: existing.id }, pendingEdgeFrom: null };
      // A one-way edge exists in the opposite direction: the new one is one-way too.
      const opposite = graph.edges.some((e) => e.from === to && e.to === from);
      const edge: Edge = {
        id: nextFreeLabel("e", graph.edges.map((e) => e.id)),
        from,
        to,
        directed: opposite,
        friction: 1,
      };
      if (graph.costModel.kind === "builtin" && graph.costModel.id === "manual") {
        edge.manualCost = round(euclidean(nodeOf(graph, from), nodeOf(graph, to), graph.pxPerUnit));
      }
      return {
        ...withGraph(state, { ...graph, edges: [...graph.edges, edge] }),
        selection: { kind: "edge", id: edge.id },
        pendingEdgeFrom: null,
      };
    }
    case "updateEdge": {
      const target = graph.edges.find((e) => e.id === action.id);
      if (!target) return state;
      const patch = { ...action.patch };
      if (patch.friction !== undefined) patch.friction = Math.max(1, patch.friction);
      if (patch.manualCost !== undefined) patch.manualCost = Math.max(0, patch.manualCost);
      // Making an edge undirected would duplicate an opposite one-way edge.
      if (patch.directed === false && graph.edges.some((e) => e.from === target.to && e.to === target.from))
        return state;
      return withGraph(state, {
        ...graph,
        edges: graph.edges.map((e) => (e.id === action.id ? { ...e, ...patch } : e)),
      });
    }
    case "reverseEdge": {
      const target = graph.edges.find((e) => e.id === action.id);
      if (!target || graph.edges.some((e) => e.from === target.to && e.to === target.from)) return state;
      return withGraph(state, {
        ...graph,
        edges: graph.edges.map((e) => (e.id === action.id ? { ...e, from: e.to, to: e.from } : e)),
      });
    }
    case "deleteEdge":
      return removeEdge(state, action.id);
    case "deleteSelection":
      if (!state.selection) return state;
      return state.selection.kind === "node"
        ? removeNode(state, state.selection.id)
        : removeEdge(state, state.selection.id);
    case "select":
      return { ...state, selection: action.selection };
    case "setMode":
      return { ...state, mode: action.mode, pendingEdgeFrom: null };
    case "setPendingEdge":
      return { ...state, pendingEdgeFrom: action.from };
    case "setGraphMeta": {
      const patch = { ...action.patch };
      if (patch.pxPerUnit !== undefined && !(patch.pxPerUnit > 0)) delete patch.pxPerUnit;
      return withGraph(state, { ...graph, ...patch });
    }
    case "setCostModel": {
      let edges = graph.edges;
      if (action.ref.kind === "builtin" && action.ref.id === "manual") {
        // Prefill manual costs with the current costs so switching loses nothing.
        const evaluated = evaluateGraph(graph);
        edges = edges.map((e) =>
          e.manualCost !== undefined
            ? e
            : {
                ...e,
                manualCost: round(
                  evaluated.edges[e.id]?.forward.cost ??
                    euclidean(nodeOf(graph, e.from), nodeOf(graph, e.to), graph.pxPerUnit) * e.friction,
                ),
              },
        );
      }
      return withGraph(state, { ...graph, costModel: action.ref, edges });
    }
    case "setProblem":
      return { ...state, problem: { ...state.problem, ...action.patch }, dirty: true };
    case "setManualH": {
      const manualH = { ...state.problem.manualH };
      if (action.value === null) delete manualH[action.nodeId];
      else manualH[action.nodeId] = action.value;
      return { ...state, problem: { ...state.problem, manualH }, dirty: true };
    }
    case "load":
      return {
        ...initialEditorState(action.graph, pruneProblem(action.problem ?? emptyProblem(action.graph), action.graph)),
        dirty: action.dirty ?? false,
      };
    case "loadProblem":
      return { ...state, problem: pruneProblem(action.problem, graph) };
    case "markSaved":
      return { ...state, dirty: false };
    case "new":
      return initialEditorState(emptyGraph());
  }
}

function nodeOf(graph: StateSpaceGraph, id: string): StateNode {
  return graph.nodes.find((n) => n.id === id)!;
}

/** Round to 4 decimals for display-friendly manual values. */
function round(n: number): number {
  return Math.round(n * 1e4) / 1e4;
}
