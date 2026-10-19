import { otherEnd, type Structure } from "./structure";

const RIGID_TOL = 1e-3; // px
const ANGLE_TOL = 1e-4; // rad
const PIVOT_TOL = 0.05; // px

/**
 * Human-readable descriptions of how moved states moved, e.g. "A rotates 7.9° clockwise about C"
 * or "D, E shift 0.4 units". Groups are connected sets of moved states; a group that moved as a
 * rigid body is described by its rotation (and pivot state, if the centre is one) or translation.
 */
export function describeMotions(
  s: Structure,
  after: Float64Array,
  moved: number[],
  pxPerUnit: number,
): string[] {
  const isMoved = new Set(moved);
  const seen = new Set<number>();
  const lines: string[] = [];
  const units = (px: number) => `${Number((px / pxPerUnit).toFixed(2))} units`;

  for (const start of moved) {
    if (seen.has(start)) continue;
    const group = [start];
    seen.add(start);
    for (let i = 0; i < group.length; i++)
      for (const bar of s.incident[group[i]]) {
        const w = otherEnd(s.bars[bar], group[i]);
        if (isMoved.has(w) && !seen.has(w)) {
          seen.add(w);
          group.push(w);
        }
      }
    const names = group.map((v) => s.names[v]).join(", ");
    const verb = (one: string, many: string) => (group.length === 1 ? one : many);
    const shift = Math.max(...group.map((v) => Math.hypot(after[2 * v] - s.pos[2 * v], after[2 * v + 1] - s.pos[2 * v + 1])));

    const motion = group.length === 1 ? pivotOfSingle(s, after, group[0], isMoved) : rigidMotion(s, after, group, isMoved);
    if (motion?.kind === "rotate") {
      const deg = Number(Math.abs((motion.angle * 180) / Math.PI).toFixed(1));
      const sense = motion.angle > 0 ? "clockwise" : "counter-clockwise"; // screen y points down
      const about =
        motion.pivot !== undefined
          ? s.names[motion.pivot]
          : `(${Number((motion.cx / pxPerUnit).toFixed(2))}, ${Number((motion.cy / pxPerUnit).toFixed(2))})`;
      lines.push(`${names} ${verb("rotates", "rotate")} ${deg}° ${sense} about ${about}`);
    } else if (motion?.kind === "shift") {
      lines.push(`${names} ${verb("shifts", "shift")} ${units(shift)}`);
    } else {
      lines.push(`${names} ${verb("moves", "move")} ${group.length > 1 ? "up to " : ""}${units(shift)}`);
    }
  }
  return lines;
}

type Motion = { kind: "rotate"; angle: number; pivot?: number; cx: number; cy: number } | { kind: "shift" } | null;

/** A single state rotated about a fixed neighbour if its distance to that neighbour is unchanged. */
function pivotOfSingle(s: Structure, after: Float64Array, v: number, isMoved: Set<number>): Motion {
  for (const bar of s.incident[v]) {
    const c = otherEnd(s.bars[bar], v);
    if (isMoved.has(c)) continue;
    const before = s.bars[bar].length;
    const now = Math.hypot(after[2 * v] - s.pos[2 * c], after[2 * v + 1] - s.pos[2 * c + 1]);
    if (Math.abs(now - before) > RIGID_TOL) continue;
    const a0 = Math.atan2(s.pos[2 * v + 1] - s.pos[2 * c + 1], s.pos[2 * v] - s.pos[2 * c]);
    const a1 = Math.atan2(after[2 * v + 1] - s.pos[2 * c + 1], after[2 * v] - s.pos[2 * c]);
    const angle = normalizeAngle(a1 - a0);
    return { kind: "rotate", angle, pivot: c, cx: s.pos[2 * c], cy: s.pos[2 * c + 1] };
  }
  return null;
}

/** Best-fit rotation + translation (2D Kabsch); null when the group did not move rigidly. */
function rigidMotion(s: Structure, after: Float64Array, group: number[], isMoved: Set<number>): Motion {
  const n = group.length;
  let qx = 0, qy = 0, px = 0, py = 0;
  for (const v of group) {
    qx += s.pos[2 * v] / n;
    qy += s.pos[2 * v + 1] / n;
    px += after[2 * v] / n;
    py += after[2 * v + 1] / n;
  }
  let dotSum = 0;
  let crossSum = 0;
  for (const v of group) {
    const ax = s.pos[2 * v] - qx, ay = s.pos[2 * v + 1] - qy;
    const bx = after[2 * v] - px, by = after[2 * v + 1] - py;
    dotSum += ax * bx + ay * by;
    crossSum += ax * by - ay * bx;
  }
  const angle = Math.atan2(crossSum, dotSum);
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  // after ≈ R·before + t
  const tx = px - (cos * qx - sin * qy);
  const ty = py - (sin * qx + cos * qy);
  for (const v of group) {
    const x = cos * s.pos[2 * v] - sin * s.pos[2 * v + 1] + tx;
    const y = sin * s.pos[2 * v] + cos * s.pos[2 * v + 1] + ty;
    if (Math.hypot(x - after[2 * v], y - after[2 * v + 1]) > RIGID_TOL) return null;
  }
  if (Math.abs(angle) < ANGLE_TOL) return { kind: "shift" };
  // Centre of rotation: (I − R) c = t.
  const det = (1 - cos) * (1 - cos) + sin * sin;
  const cx = ((1 - cos) * tx - sin * ty) / det;
  const cy = (sin * tx + (1 - cos) * ty) / det;
  let pivot: number | undefined;
  for (let v = 0; v < s.ids.length; v++) {
    if (isMoved.has(v)) continue;
    if (Math.hypot(s.pos[2 * v] - cx, s.pos[2 * v + 1] - cy) < PIVOT_TOL) pivot = v;
  }
  return { kind: "rotate", angle, pivot, cx, cy };
}

function normalizeAngle(a: number): number {
  while (a > Math.PI) a -= 2 * Math.PI;
  while (a < -Math.PI) a += 2 * Math.PI;
  return a;
}
