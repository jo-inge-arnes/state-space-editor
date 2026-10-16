/**
 * Compiles user-written function bodies into callable functions.
 *
 * This runs in the browser only, on code the user typed themselves. The server
 * stores the source text as part of the JSON files but never executes it.
 */

export type Compiled<F> = { ok: true; fn: F } | { ok: false; error: string };

export function compileUserFunction<F extends (...args: never[]) => unknown>(
  params: readonly string[],
  source: string,
): Compiled<F> {
  try {
    const fn = new Function(...params, `"use strict";\n${source}`) as F;
    return { ok: true, fn };
  } catch (err) {
    return { ok: false, error: `Compile error: ${errorMessage(err)}` };
  }
}

export type NumberResult = { ok: true; value: number } | { ok: false; error: string };

/** Call `fn` and check that it produced a finite number (optionally ≥ 0). */
export function evaluateNumber(
  fn: () => unknown,
  { nonNegative = false }: { nonNegative?: boolean } = {},
): NumberResult {
  let value: unknown;
  try {
    value = fn();
  } catch (err) {
    return { ok: false, error: errorMessage(err) };
  }
  if (typeof value !== "number" || !Number.isFinite(value))
    return { ok: false, error: `Expected a finite number, got ${describe(value)}` };
  if (nonNegative && value < 0) return { ok: false, error: `Expected a value ≥ 0, got ${value}` };
  return { ok: true, value };
}

export function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function describe(value: unknown): string {
  if (typeof value === "number") return String(value);
  if (value === undefined) return "undefined (missing return?)";
  try {
    return JSON.stringify(value) ?? String(value);
  } catch {
    return String(value);
  }
}
