/**
 * Deterministic descriptive statistics and deadline calculations for Phase 0 spikes (`07` §1.2, §4.1).
 */

export function median(values: readonly number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) {
    return sorted[mid] ?? 0;
  }
  return ((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2;
}

export function percentile(values: readonly number[], q: number): number {
  if (values.length === 0) return 0;
  const clamped = Math.max(0, Math.min(1, q));
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.ceil(clamped * sorted.length) - 1;
  return sorted[Math.max(0, Math.min(sorted.length - 1, idx))] ?? 0;
}

/**
 * Computes Web `l1_deadline_ms` (`07` §1.2 S-W4, D-28): `max(20_000, ceil(2 * p99))`.
 */
export function computeWebL1DeadlineMs(latenciesMs: readonly number[]): number {
  if (latenciesMs.length === 0) return 20_000;
  const p99 = percentile(latenciesMs, 0.99);
  return Math.max(20_000, Math.ceil(2 * p99));
}

export function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

export function estimateOutputTokens(text: string): number {
  if (text.length === 0) return 0;
  return Math.ceil(text.length / 4);
}
