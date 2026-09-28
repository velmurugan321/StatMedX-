/**
 * Offline statistical primitives for StatMedX.
 *
 * Pure TypeScript: no network, backend, browser APIs, or third-party runtime
 * dependencies. These are foundational descriptive routines, not a substitute
 * for the validated Python analysis engine yet.
 */
export type DataRow = Record<string, unknown>;

export interface NumericSummary {
  n: number;
  missing: number;
  mean: number | null;
  median: number | null;
  sd: number | null;
  min: number | null;
  max: number | null;
  q1: number | null;
  q3: number | null;
}

export interface CategoryCount {
  value: string;
  n: number;
  percent: number;
}

export interface CategorySummary {
  n: number;
  missing: number;
  levels: CategoryCount[];
}

function isMissing(value: unknown): boolean {
  return value === null || value === undefined ||
    (typeof value === "string" && value.trim() === "") ||
    (typeof value === "number" && !Number.isFinite(value));
}

function quantile(sorted: number[], p: number): number | null {
  if (!sorted.length) return null;
  const position = (sorted.length - 1) * p;
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  if (lower === upper) return sorted[lower];
  return sorted[lower] + (sorted[upper] - sorted[lower]) * (position - lower);
}

/** Summarize values that are genuinely numeric or parse cleanly as numbers. */
export function summarizeNumeric(values: unknown[]): NumericSummary {
  const valid: number[] = [];
  let missing = 0;
  for (const value of values) {
    if (isMissing(value)) {
      missing++;
      continue;
    }
    const number = typeof value === "number" ? value :
      typeof value === "string" ? Number(value.trim()) : Number.NaN;
    if (Number.isFinite(number)) valid.push(number);
    else missing++;
  }
  valid.sort((a, b) => a - b);
  const n = valid.length;
  const mean = n ? valid.reduce((sum, x) => sum + x, 0) / n : null;
  const median = quantile(valid, 0.5);
  const variance = n > 1 && mean !== null
    ? valid.reduce((sum, x) => sum + (x - mean) ** 2, 0) / (n - 1)
    : null;
  return {
    n, missing, mean, median,
    sd: variance === null ? null : Math.sqrt(variance),
    min: n ? valid[0] : null,
    max: n ? valid[n - 1] : null,
    q1: quantile(valid, 0.25),
    q3: quantile(valid, 0.75),
  };
}

/** Return category frequencies ordered by descending count, then label. */
export function summarizeCategorical(values: unknown[]): CategorySummary {
  const counts = new Map<string, number>();
  let missing = 0;
  for (const value of values) {
    if (isMissing(value)) {
      missing++;
      continue;
    }
    const label = String(value).trim();
    if (!label) missing++;
    else counts.set(label, (counts.get(label) || 0) + 1);
  }
  const n = values.length - missing;
  const levels = Array.from(counts, ([value, count]) => ({
    value, n: count, percent: n ? (count / n) * 100 : 0,
  })).sort((a, b) => b.n - a.n || a.value.localeCompare(b.value));
  return { n, missing, levels };
}

/** Summarize selected columns from row-oriented local data. */
export function summarizeDataset(rows: DataRow[], columns: string[]) {
  return Object.fromEntries(columns.map((column) => {
    const values = rows.map((row) => row[column]);
    return [column, { numeric: summarizeNumeric(values), categorical: summarizeCategorical(values) }];
  }));
}
