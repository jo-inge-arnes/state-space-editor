import { choleskySolve } from "./linalg";

export interface LengthConstraint {
  u: number;
  v: number;
  /** Length to hold, in px. */
  length: number;
  /** Bar index, used to report resistance. */
  bar: number;
}

export interface ContinuationInput {
  /** Positions of all nodes in px (not modified). */
  pos: Float64Array;
  /** Nodes that may move. */
  free: readonly number[];
  /** Lengths to hold. Each constraint touches a free node. */
  keep: readonly LengthConstraint[];
  /** The edited bar, whose length goes from `from` to `to` (px). One endpoint is free. */
  target: { u: number; v: number; from: number; to: number };
  /** performance.now() time to give up. */
  deadline?: number;
}

export interface ContinuationResult {
  ok: boolean;
  /** Positions of all nodes (px). */
  pos: Float64Array;
  /** Target length reached in px (equals `to` when ok). */
  reached: number;
  /** When stuck: how strongly each kept bar resisted the next step (|multiplier| by bar index). */
  resistance?: Map<number, number>;
}

const TOL = 1e-7; // px
const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));

/**
 * Move the free states so the target bar reaches its new length while the kept bars hold theirs.
 *
 * Continuation: the target length is stepped from its current to its new value. After each step a
 * damped Gauss–Newton corrector takes minimum-norm steps back onto the constraint set, so states
 * move as little as possible and follow the continuous motion (e.g. a rotation about a pivot)
 * instead of flipping to a mirror image. A step that would move a state by more than a fifth of
 * the shortest bar involved is retried at half size. When steps become tiny the target is out of
 * reach for this motion (a turning point), and the reached length is reported.
 */
export function continueLength(input: ContinuationInput): ContinuationResult {
  const first = run(input, false);
  if (first.ok || first.reached !== input.target.from) return first;
  // No progress from the start: typically a singular configuration such as collinear states, where
  // the bending direction is only second order. A tiny deterministic nudge picks a direction.
  const second = run(input, true);
  const progress = (r: ContinuationResult) => Math.abs(r.reached - input.target.from);
  return second.ok || progress(second) > progress(first) ? second : first;
}

interface Row {
  u: number;
  v: number;
  length: number;
}

function run(input: ContinuationInput, nudge: boolean): ContinuationResult {
  const { pos, free, keep, target, deadline = Infinity } = input;
  const x = Float64Array.from(pos);
  const rows: Row[] = keep.map(({ u, v, length }) => ({ u, v, length }));
  const targetRow: Row = { u: target.u, v: target.v, length: target.from };
  rows.push(targetRow);
  const isFree = new Uint8Array(pos.length / 2);
  for (const v of free) isFree[v] = 1;

  const shortest = Math.max(1, Math.min(target.from, target.to, ...keep.map((c) => c.length)));
  const maxMove = 0.2 * shortest;
  if (nudge)
    free.forEach((v, i) => {
      x[2 * v] += 1e-4 * shortest * Math.cos(i * GOLDEN_ANGLE + 1);
      x[2 * v + 1] += 1e-4 * shortest * Math.sin(i * GOLDEN_ANGLE + 1);
    });

  const total = target.to - target.from;
  let t = 0;
  let step = 0.5;
  let multipliers: Float64Array | undefined;
  while (t < 1 && performance.now() < deadline) {
    const t1 = Math.min(1, t + step);
    targetRow.length = target.from + t1 * total;
    const c = correct(x, rows, isFree);
    if (c.ok && largestMove(c.x, x, free) <= maxMove) {
      x.set(c.x);
      t = t1;
      step = Math.min(0.5, step * 2);
    } else {
      multipliers = c.y;
      step /= 2;
      if (step < 1e-4) break;
    }
  }

  if (t >= 1) return { ok: true, pos: x, reached: target.to };
  const resistance = new Map<number, number>();
  if (multipliers) keep.forEach((c, i) => resistance.set(c.bar, Math.abs(multipliers[i])));
  return { ok: false, pos: x, reached: target.from + t * total, resistance };
}

/** Damped Gauss–Newton (Levenberg–Marquardt) with minimum-norm steps: Δx = −Jᵀ(JJᵀ + μI)⁻¹ r. */
function correct(x0: Float64Array, rows: Row[], isFree: Uint8Array): { ok: boolean; x: Float64Array; y?: Float64Array } {
  const k = rows.length;
  let x = Float64Array.from(x0);
  let r = residuals(x, rows);
  let rn = sumOfSquares(r);
  let mu = 1e-9;
  let y: Float64Array | undefined;
  for (let iter = 0; iter < 60; iter++) {
    if (maxAbs(r) < TOL) return { ok: true, x, y };
    const dir = directions(x, rows);
    const A = normalMatrix(rows, dir, isFree);
    for (let i = 0; i < k; i++) A[i * k + i] += mu;
    const sol = choleskySolve(A, k, r);
    if (!sol) {
      mu *= 10;
      continue;
    }
    y = sol;
    const next = Float64Array.from(x);
    for (let i = 0; i < k; i++) {
      const { u, v } = rows[i];
      const dx = dir[2 * i] * sol[i];
      const dy = dir[2 * i + 1] * sol[i];
      if (isFree[u]) {
        next[2 * u] -= dx;
        next[2 * u + 1] -= dy;
      }
      if (isFree[v]) {
        next[2 * v] += dx;
        next[2 * v + 1] += dy;
      }
    }
    const rNext = residuals(next, rows);
    const rnNext = sumOfSquares(rNext);
    if (rnNext < rn) {
      x = next;
      r = rNext;
      rn = rnNext;
      mu = Math.max(mu / 10, 1e-12);
    } else {
      mu *= 10;
      if (mu > 1e8) break;
    }
  }
  return { ok: maxAbs(r) < TOL, x, y };
}

function residuals(x: Float64Array, rows: Row[]): Float64Array {
  return Float64Array.from(rows, ({ u, v, length }) => Math.hypot(x[2 * u] - x[2 * v], x[2 * u + 1] - x[2 * v + 1]) - length);
}

/** Unit direction from v to u for every row (the Jacobian entries at u; negated at v). */
function directions(x: Float64Array, rows: Row[]): Float64Array {
  const dir = new Float64Array(rows.length * 2);
  rows.forEach(({ u, v }, i) => {
    const dx = x[2 * u] - x[2 * v];
    const dy = x[2 * u + 1] - x[2 * v + 1];
    const len = Math.hypot(dx, dy);
    if (len < 1e-12) {
      dir[2 * i] = 1; // coincident states: any direction will do
    } else {
      dir[2 * i] = dx / len;
      dir[2 * i + 1] = dy / len;
    }
  });
  return dir;
}

/** J Jᵀ, built from the rows that share each free node (rows have at most two nonzero blocks). */
function normalMatrix(rows: Row[], dir: Float64Array, isFree: Uint8Array): Float64Array {
  const k = rows.length;
  const A = new Float64Array(k * k);
  const atNode = new Map<number, [row: number, sign: number][]>();
  const add = (node: number, row: number, sign: number) => {
    if (!isFree[node]) return;
    const list = atNode.get(node);
    if (list) list.push([row, sign]);
    else atNode.set(node, [[row, sign]]);
  };
  rows.forEach(({ u, v }, i) => {
    add(u, i, 1);
    add(v, i, -1);
  });
  for (const list of atNode.values())
    for (const [i, si] of list)
      for (const [j, sj] of list) A[i * k + j] += si * sj * (dir[2 * i] * dir[2 * j] + dir[2 * i + 1] * dir[2 * j + 1]);
  return A;
}

function largestMove(a: Float64Array, b: Float64Array, nodes: readonly number[]): number {
  let max = 0;
  for (const v of nodes) max = Math.max(max, Math.hypot(a[2 * v] - b[2 * v], a[2 * v + 1] - b[2 * v + 1]));
  return max;
}

function sumOfSquares(r: Float64Array): number {
  let sum = 0;
  for (const x of r) sum += x * x;
  return sum;
}

function maxAbs(r: Float64Array): number {
  let max = 0;
  for (const x of r) max = Math.max(max, Math.abs(x));
  return max;
}
