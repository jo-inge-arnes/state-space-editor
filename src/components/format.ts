/** Compact number formatting for costs and heuristic values (max 2 decimals). */
export function formatNumber(n: number): string {
  if (n === Infinity) return "∞";
  if (!Number.isFinite(n)) return String(n);
  return Number(n.toFixed(2)).toString();
}
