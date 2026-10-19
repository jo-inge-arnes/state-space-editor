/** Small dense linear algebra for the layout solver (matrices are row-major Float64Arrays). */

/** Solve A x = b for a symmetric positive definite n×n matrix; null if A is not positive definite. */
export function choleskySolve(A: Float64Array, n: number, b: Float64Array): Float64Array | null {
  const L = new Float64Array(n * n);
  for (let i = 0; i < n; i++) {
    for (let j = 0; j <= i; j++) {
      let sum = A[i * n + j];
      for (let k = 0; k < j; k++) sum -= L[i * n + k] * L[j * n + k];
      if (i === j) {
        if (!(sum > 0)) return null;
        L[i * n + i] = Math.sqrt(sum);
      } else {
        L[i * n + j] = sum / L[j * n + j];
      }
    }
  }
  const y = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    let sum = b[i];
    for (let k = 0; k < i; k++) sum -= L[i * n + k] * y[k];
    y[i] = sum / L[i * n + i];
  }
  const x = new Float64Array(n);
  for (let i = n - 1; i >= 0; i--) {
    let sum = y[i];
    for (let k = i + 1; k < n; k++) sum -= L[k * n + i] * x[k];
    x[i] = sum / L[i * n + i];
  }
  return x;
}

/**
 * True if `v` is not in the span of `rows` (relative tolerance `tol`). Modified Gram–Schmidt with
 * a second orthogonalisation pass for stability.
 */
export function outsideSpan(rows: Float64Array[], v: Float64Array, tol = 1e-8): boolean {
  const basis: Float64Array[] = [];
  const reduce = (w: Float64Array) => {
    for (let pass = 0; pass < 2; pass++)
      for (const q of basis) {
        const d = dot(q, w);
        for (let i = 0; i < w.length; i++) w[i] -= d * q[i];
      }
  };
  for (const row of rows) {
    const w = Float64Array.from(row);
    reduce(w);
    const n = norm(w);
    if (n > tol * Math.max(1, norm(row))) basis.push(w.map((x) => x / n));
  }
  const w = Float64Array.from(v);
  reduce(w);
  return norm(w) > tol * Math.max(1, norm(v));
}

function dot(a: Float64Array, b: Float64Array): number {
  let sum = 0;
  for (let i = 0; i < a.length; i++) sum += a[i] * b[i];
  return sum;
}

function norm(a: Float64Array): number {
  return Math.sqrt(dot(a, a));
}
