import type { StateSpaceGraph } from "../schema";

/**
 * A length constraint between two states. All edges joining the same pair (e.g. opposite one-way
 * edges) always have the same length, so the layout algorithms treat them as one bar.
 */
export interface Bar {
  u: number;
  v: number;
  edgeIds: string[];
  /** Current length in px. */
  length: number;
}

/** Index-based geometric view of a graph used by the layout algorithms. */
export interface Structure {
  /** Node ids by index. */
  ids: string[];
  names: string[];
  indexOf: Map<string, number>;
  /** Positions in px: node i at [2i, 2i + 1]. */
  pos: Float64Array;
  bars: Bar[];
  barOfEdge: Map<string, number>;
  /** Bar indices at each node. */
  incident: number[][];
}

export function buildStructure(graph: StateSpaceGraph): Structure {
  const ids = graph.nodes.map((n) => n.id);
  const names = graph.nodes.map((n) => n.name);
  const indexOf = new Map(ids.map((id, i) => [id, i]));
  const pos = new Float64Array(ids.length * 2);
  graph.nodes.forEach((n, i) => {
    pos[2 * i] = n.x;
    pos[2 * i + 1] = n.y;
  });
  const bars: Bar[] = [];
  const barOfEdge = new Map<string, number>();
  const barOfPair = new Map<string, number>();
  const incident: number[][] = ids.map(() => []);
  for (const e of graph.edges) {
    const a = indexOf.get(e.from);
    const b = indexOf.get(e.to);
    if (a === undefined || b === undefined || a === b) continue;
    const [u, v] = a < b ? [a, b] : [b, a];
    const key = `${u},${v}`;
    let bar = barOfPair.get(key);
    if (bar === undefined) {
      bar = bars.length;
      bars.push({ u, v, edgeIds: [], length: distance(pos, u, v) });
      barOfPair.set(key, bar);
      incident[u].push(bar);
      incident[v].push(bar);
    }
    bars[bar].edgeIds.push(e.id);
    barOfEdge.set(e.id, bar);
  }
  return { ids, names, indexOf, pos, bars, barOfEdge, incident };
}

export function distance(pos: Float64Array, u: number, v: number): number {
  return Math.hypot(pos[2 * u] - pos[2 * v], pos[2 * u + 1] - pos[2 * v + 1]);
}

export function otherEnd(bar: Bar, node: number): number {
  return bar.u === node ? bar.v : bar.u;
}

/**
 * Biconnected block of every bar (iterative Hopcroft–Tarjan). A bar's length can only ever depend
 * on the bars of its own block: everything else hangs off a cut vertex and can follow it rigidly.
 * Bridges get a block of their own.
 */
export function blocksOf(s: Structure): Int32Array {
  const n = s.ids.length;
  const disc = new Int32Array(n).fill(-1);
  const low = new Int32Array(n);
  const block = new Int32Array(s.bars.length).fill(-1);
  const barStack: number[] = [];
  let time = 0;
  let blocks = 0;
  for (let root = 0; root < n; root++) {
    if (disc[root] !== -1) continue;
    disc[root] = low[root] = time++;
    // Frames: [node, bar used to reach it, next incident index].
    const stack: [number, number, number][] = [[root, -1, 0]];
    while (stack.length) {
      const frame = stack[stack.length - 1];
      const [u, parentBar] = frame;
      if (frame[2] < s.incident[u].length) {
        const bar = s.incident[u][frame[2]++];
        if (bar === parentBar) continue;
        const w = otherEnd(s.bars[bar], u);
        if (disc[w] === -1) {
          barStack.push(bar);
          disc[w] = low[w] = time++;
          stack.push([w, bar, 0]);
        } else if (disc[w] < disc[u]) {
          barStack.push(bar); // back edge
          low[u] = Math.min(low[u], disc[w]);
        }
      } else {
        stack.pop();
        if (!stack.length) continue;
        const p = stack[stack.length - 1][0];
        low[p] = Math.min(low[p], low[u]);
        if (low[u] >= disc[p]) {
          let bar: number;
          do {
            bar = barStack.pop()!;
            block[bar] = blocks;
          } while (bar !== parentBar);
          blocks++;
        }
      }
    }
  }
  return block;
}

const FAR = 1 << 30;

/** Number of bars from the nearest source to every node (a large number when unreachable). */
export function hopDistances(s: Structure, sources: number[]): Int32Array {
  const hop = new Int32Array(s.ids.length).fill(FAR);
  const queue = [...sources];
  for (const v of sources) hop[v] = 0;
  for (let i = 0; i < queue.length; i++) {
    const u = queue[i];
    for (const bar of s.incident[u]) {
      const w = otherEnd(s.bars[bar], u);
      if (hop[w] === FAR) {
        hop[w] = hop[u] + 1;
        queue.push(w);
      }
    }
  }
  return hop;
}

/**
 * Ordering key for bars: hop distance from the edited bar, with the straight-line distance between
 * midpoints as a tie-break (kept below 1 so it never overrides the hop count).
 */
export function barDistances(s: Structure, target: number): Float64Array {
  const t = s.bars[target];
  const hop = hopDistances(s, [t.u, t.v]);
  const mid = (b: Bar) => [(s.pos[2 * b.u] + s.pos[2 * b.v]) / 2, (s.pos[2 * b.u + 1] + s.pos[2 * b.v + 1]) / 2];
  const [tx, ty] = mid(t);
  const geo = s.bars.map((b) => {
    const [x, y] = mid(b);
    return Math.hypot(x - tx, y - ty);
  });
  const maxGeo = Math.max(1, ...geo);
  return Float64Array.from(s.bars, (b, i) => Math.min(hop[b.u], hop[b.v]) + (0.5 * geo[i]) / maxGeo);
}

/** Nodes connected to `start` (including it). */
export function componentOf(s: Structure, start: number): number[] {
  const seen = new Uint8Array(s.ids.length);
  const out = [start];
  seen[start] = 1;
  for (let i = 0; i < out.length; i++)
    for (const bar of s.incident[out[i]]) {
      const w = otherEnd(s.bars[bar], out[i]);
      if (!seen[w]) {
        seen[w] = 1;
        out.push(w);
      }
    }
  return out;
}
