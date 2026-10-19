import { outsideSpan } from "./linalg";
import { continueLength, type ContinuationResult, type LengthConstraint } from "./solver";
import { otherEnd, type Structure } from "./structure";

export type Realization = ContinuationResult;

const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));

/**
 * Positions nudged by a tiny deterministic amount, used only for the rank tests. States on a grid
 * are often collinear, where the first-order analysis wrongly reports rigidity; generic positions
 * give the answer that holds for every finite motion away from that special configuration.
 */
export function genericPositions(s: Structure): Float64Array {
  const lengths = s.bars.map((b) => b.length).sort((a, b) => a - b);
  const delta = 1e-3 * Math.max(1, lengths[lengths.length >> 1] ?? 1);
  const pos = Float64Array.from(s.pos);
  for (let i = 0; i < s.ids.length; i++) {
    pos[2 * i] += delta * Math.cos(i * GOLDEN_ANGLE);
    pos[2 * i + 1] += delta * Math.sin(i * GOLDEN_ANGLE);
  }
  return pos;
}

interface Context {
  s: Structure;
  /** Per bar: 1 if its length must be kept. */
  kept: Uint8Array;
  target: number;
  targetPx: number;
  generic: Float64Array;
  deadline: number;
}

/**
 * Change the target bar's length moving as few states as possible: grow a set M of moving states
 * from `seed`. Each step adds the neighbour that adds the most freedom: two coordinates minus the
 * kept bars it brings to states outside M. Ties go to states closer to the edited bar. Once
 * 2|M| ≥ (kept bars touching M) + 1 and the target's row is independent of those bars' rows
 * (rigidity matrix at generic positions), the continuation solver tries the actual motion. If it
 * stops short (out of range), the set keeps growing.
 *
 * M = {a} with one kept neighbour c is a rotation of a about c on a fixed radius. Larger sets give
 * rotations of groups and linkage motions.
 */
export function realizeFewestMoved(
  ctx: Context,
  seed: number,
  fixed: ReadonlySet<number>,
  hop: Int32Array,
): Realization | null {
  const { s, kept, target } = ctx;
  const { bars, incident } = s;
  const inM = new Uint8Array(s.ids.length);
  const M = [seed];
  inM[seed] = 1;
  let lastDof = -Infinity;
  let best: Realization | null = null;
  const progress = (r: Realization) => Math.abs(r.reached - bars[target].length);

  while (performance.now() < ctx.deadline) {
    const touching = keptTouching(ctx, M, inM);
    const dof = 2 * M.length - touching.length - 1;
    if (dof >= 0 && dof > lastDof && targetIsFree(ctx, M, touching)) {
      lastDof = dof;
      const result = solve(ctx, M, touching);
      if (result.ok) return result;
      if (!best || progress(result) > progress(best)) best = result;
    }

    let pick = -1;
    let pickGain = -Infinity;
    for (const w of M)
      for (const bar of incident[w]) {
        const v = otherEnd(bars[bar], w);
        if (inM[v] || fixed.has(v)) continue;
        let outside = 0;
        for (const b of incident[v]) if (kept[b] && !inM[otherEnd(bars[b], v)]) outside++;
        const gain = 2 - outside;
        const better =
          gain > pickGain || (gain === pickGain && (hop[v] < hop[pick] || (hop[v] === hop[pick] && v < pick)));
        if (better) {
          pick = v;
          pickGain = gain;
        }
      }
    if (pick === -1) break;
    M.push(pick);
    inM[pick] = 1;
  }
  return best;
}

/** Least total movement: every state in `free` may move; minimum-norm steps spread the change. */
export function realizeSmooth(ctx: Context, free: number[]): Realization {
  const inFree = new Uint8Array(ctx.s.ids.length);
  for (const v of free) inFree[v] = 1;
  return solve(ctx, free, keptTouching(ctx, free, inFree));
}

function keptTouching({ s, kept }: Context, nodes: number[], inSet: Uint8Array): number[] {
  const seen = new Set<number>();
  for (const v of nodes) for (const bar of s.incident[v]) if (kept[bar] && !seen.has(bar)) seen.add(bar);
  return [...seen].filter((bar) => inSet[s.bars[bar].u] || inSet[s.bars[bar].v]);
}

function targetIsFree({ s, generic, target }: Context, M: number[], touching: number[]): boolean {
  const col = new Map(M.map((v, i) => [v, i]));
  const row = (u: number, v: number) => {
    const r = new Float64Array(2 * M.length);
    const dx = generic[2 * u] - generic[2 * v];
    const dy = generic[2 * u + 1] - generic[2 * v + 1];
    const len = Math.hypot(dx, dy) || 1;
    const cu = col.get(u);
    const cv = col.get(v);
    if (cu !== undefined) {
      r[2 * cu] = dx / len;
      r[2 * cu + 1] = dy / len;
    }
    if (cv !== undefined) {
      r[2 * cv] = -dx / len;
      r[2 * cv + 1] = -dy / len;
    }
    return r;
  };
  const t = s.bars[target];
  return outsideSpan(
    touching.map((bar) => row(s.bars[bar].u, s.bars[bar].v)),
    row(t.u, t.v),
  );
}

function solve(ctx: Context, free: number[], touching: number[]): Realization {
  const { s, target, targetPx, deadline } = ctx;
  const t = s.bars[target];
  const keep: LengthConstraint[] = touching.map((bar) => ({
    u: s.bars[bar].u,
    v: s.bars[bar].v,
    length: s.bars[bar].length,
    bar,
  }));
  return continueLength({
    pos: s.pos,
    free,
    keep,
    target: { u: t.u, v: t.v, from: t.length, to: targetPx },
    deadline,
  });
}

export type { Context as RealizeContext };
