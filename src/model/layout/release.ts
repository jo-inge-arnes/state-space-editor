import { PebbleGame } from "./pebbleGame";
import type { Structure } from "./structure";

export interface ReleaseResult {
  /** Sets of bars that must be allowed to change length, smallest first; [[]] when none are needed. */
  sets: number[][];
  /** True when the sets are proven to have the minimum size (generic rigidity). */
  minimal: boolean;
  /** When no set exists: the locked bars that hold the edited bar's length fixed. */
  blocking?: number[];
  tests: number;
}

interface Options {
  /** Largest set size searched exactly before falling back to a greedy choice. */
  maxSize?: number;
  /** Stop after this many sets of the minimum size. */
  maxSets?: number;
  /** performance.now() time to stop searching. */
  deadline: number;
  /** Ordering key per bar: release bars near the edited bar first. */
  distance: Float64Array;
}

/**
 * Find the fewest bars to release (let change length) so that the target bar's length can change
 * while all other bars of its block keep theirs.
 *
 * In the 2D generic rigidity matroid the target is free iff it is independent of the kept bars, so
 * a release set must hit every circuit through the target. Each failed test yields a rigid region
 * that contains such a circuit; the search branches on its releasable bars (iterative deepening,
 * disjoint branches) and checks candidates incrementally with the pebble game.
 */
export function findReleaseSets(
  s: Structure,
  target: number,
  blockBars: number[],
  locked: ReadonlySet<number>,
  { maxSize = 4, maxSets = 6, deadline, distance }: Options,
): ReleaseResult {
  const { u: a, v: b } = s.bars[target];
  const base = new PebbleGame(s.ids.length, s.bars);
  const others = blockBars.filter((bar) => bar !== target);
  const redundant = others.filter((bar) => !base.add(bar));
  const releasable = others.filter((bar) => !locked.has(bar));
  const byDistance = (x: number, y: number) => distance[x] - distance[y] || x - y;
  let tests = 0;

  /** Is the target free once the bars in F are released? Otherwise also returns the rigid region. */
  const test = (F: number[]): { free: true } | { free: false; region: number[] } => {
    tests++;
    const game = base.clone();
    if (F.length) {
      const released = new Set(F);
      for (const bar of F) game.remove(bar);
      // A redundant bar may now carry the rigidity that a released one provided.
      for (const bar of redundant) if (!released.has(bar)) game.add(bar);
    }
    return game.isFlexiblePair(a, b) ? { free: true } : { free: false, region: game.rigidRegion(a, b) };
  };

  const root = test([]);
  if (root.free) return { sets: [[]], minimal: true, tests };
  const all = test(releasable);
  if (!all.free) return { sets: [], minimal: true, blocking: all.region, tests };

  let timedOut = false;
  let found: number[][] = [];
  const search = (F: number[], kept: ReadonlySet<number>, depthLeft: number) => {
    if (found.length >= maxSets || timedOut) return;
    if (performance.now() > deadline) {
      timedOut = true;
      return;
    }
    const t = test(F);
    if (t.free) {
      found.push([...F]);
      return;
    }
    if (depthLeft === 0) return;
    const branch = t.region.filter((bar) => !locked.has(bar) && !kept.has(bar)).sort(byDistance);
    // Branch i releases bar i and keeps bars 0..i-1, so every set is generated once.
    const keptHere = new Set(kept);
    for (const bar of branch) {
      search([...F, bar], keptHere, depthLeft - 1);
      if (found.length >= maxSets || timedOut) return;
      keptHere.add(bar);
    }
  };

  for (let k = 1; k <= maxSize && !timedOut; k++) {
    found = [];
    search([], new Set(), k);
    if (found.length) {
      const cost = (F: number[]) => F.reduce((sum, bar) => sum + distance[bar], 0);
      found.sort((x, y) => cost(x) - cost(y));
      return { sets: found, minimal: true, tests };
    }
  }

  // Fallback (too many releases needed or out of time): add the nearest bar of each rigid region,
  // then drop any bar that turned out to be unnecessary.
  const F: number[] = [];
  for (;;) {
    const t = test(F);
    if (t.free) break;
    const next = t.region.filter((bar) => !locked.has(bar)).sort(byDistance)[0];
    if (next === undefined) return { sets: [], minimal: true, blocking: t.region, tests };
    F.push(next);
  }
  for (let i = F.length - 1; i >= 0; i--) {
    const without = F.filter((_, j) => j !== i);
    if (test(without).free) F.splice(i, 1);
  }
  return { sets: [F], minimal: false, tests };
}
