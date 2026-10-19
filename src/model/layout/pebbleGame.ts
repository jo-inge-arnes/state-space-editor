import type { Bar } from "./structure";

type Ends = Pick<Bar, "u" | "v">;

/**
 * The (2,3) pebble game of Jacobs & Hendrickson (1997) for 2D generic rigidity (Laman graphs).
 *
 * Every node owns two pebbles. An accepted bar is covered by a pebble of one endpoint and directed
 * away from it. A bar is independent of the accepted bars, i.e. its length is not already fixed by
 * them, iff four pebbles can be gathered on its two endpoints. Pebbles move by reversing directed
 * paths, which keeps the invariant: free pebbles + out-degree = 2 at every node.
 */
export class PebbleGame {
  private readonly bars: readonly Ends[];
  private readonly pebbles: Int8Array;
  private readonly tail: Int32Array;
  private readonly head: Int32Array;
  private readonly out: number[][];
  private readonly mark: Int32Array;
  private readonly via: Int32Array;
  private stamp = 0;

  constructor(nodeCount: number, bars: readonly Ends[], copyFrom?: PebbleGame) {
    this.bars = bars;
    if (copyFrom) {
      this.pebbles = copyFrom.pebbles.slice();
      this.tail = copyFrom.tail.slice();
      this.head = copyFrom.head.slice();
      this.out = copyFrom.out.map((o) => o.slice());
    } else {
      this.pebbles = new Int8Array(nodeCount).fill(2);
      this.tail = new Int32Array(bars.length).fill(-1);
      this.head = new Int32Array(bars.length).fill(-1);
      this.out = Array.from({ length: nodeCount }, () => []);
    }
    this.mark = new Int32Array(nodeCount);
    this.via = new Int32Array(nodeCount);
  }

  clone(): PebbleGame {
    return new PebbleGame(this.pebbles.length, this.bars, this);
  }

  /** Accept the bar if it is independent of the accepted bars. Returns whether it was accepted. */
  add(bar: number): boolean {
    const { u, v } = this.bars[bar];
    if (!this.gather(u, v)) return false;
    this.pebbles[u]--;
    this.tail[bar] = u;
    this.head[bar] = v;
    this.out[u].push(bar);
    return true;
  }

  /** Drop an accepted bar (its pebble returns to the node covering it). No-op for other bars. */
  remove(bar: number): void {
    const t = this.tail[bar];
    if (t === -1) return;
    removeFrom(this.out[t], bar);
    this.pebbles[t]++;
    this.tail[bar] = this.head[bar] = -1;
  }

  /** True if the accepted bars leave the distance between u and v free (generically). */
  isFlexiblePair(u: number, v: number): boolean {
    return this.gather(u, v);
  }

  /**
   * After `isFlexiblePair(u, v)` returned false: the accepted bars of the rigid region holding u and
   * v together. It is the reach of u and v in the pebble graph, with 2|V'| − 3 bars, so any set of
   * bars whose release frees the pair must include at least one of these bars.
   */
  rigidRegion(u: number, v: number): number[] {
    const stamp = ++this.stamp;
    this.mark[u] = this.mark[v] = stamp;
    const stack = [u, v];
    const region: number[] = [];
    while (stack.length) {
      const x = stack.pop()!;
      for (const bar of this.out[x]) {
        region.push(bar);
        const y = this.head[bar];
        if (this.mark[y] !== stamp) {
          this.mark[y] = stamp;
          stack.push(y);
        }
      }
    }
    return region;
  }

  /** Try to collect two free pebbles on each of u and v. */
  private gather(u: number, v: number): boolean {
    let progress = true;
    while (progress && (this.pebbles[u] < 2 || this.pebbles[v] < 2)) {
      progress = false;
      if (this.pebbles[u] < 2 && this.fetch(u, u, v)) progress = true;
      if (this.pebbles[v] < 2 && this.fetch(v, u, v)) progress = true;
    }
    return this.pebbles[u] === 2 && this.pebbles[v] === 2;
  }

  /**
   * Bring one free pebble to `start` along a directed path. The search may pass through the
   * reserved nodes but never takes their pebbles.
   */
  private fetch(start: number, reserved1: number, reserved2: number): boolean {
    const stamp = ++this.stamp;
    this.mark[start] = stamp;
    const stack = [start];
    while (stack.length) {
      const x = stack.pop()!;
      for (const bar of this.out[x]) {
        const y = this.head[bar];
        if (this.mark[y] === stamp) continue;
        this.mark[y] = stamp;
        this.via[y] = bar;
        if (y !== reserved1 && y !== reserved2 && this.pebbles[y] > 0) {
          this.reversePath(start, y);
          return true;
        }
        stack.push(y);
      }
    }
    return false;
  }

  private reversePath(start: number, end: number): void {
    for (let y = end; y !== start; ) {
      const bar = this.via[y];
      const x = this.tail[bar];
      removeFrom(this.out[x], bar);
      this.tail[bar] = y;
      this.head[bar] = x;
      this.out[y].push(bar);
      y = x;
    }
    this.pebbles[end]--;
    this.pebbles[start]++;
  }
}

function removeFrom(list: number[], item: number): void {
  const i = list.indexOf(item);
  if (i === -1) return;
  list[i] = list[list.length - 1];
  list.pop();
}
