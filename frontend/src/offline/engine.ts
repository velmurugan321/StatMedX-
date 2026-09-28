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

export interface CrosstabResult {
  rowLevels: string[];
  columnLevels: string[];
  cells: number[][];
  rowTotals: number[];
  columnTotals: number[];
  total: number;
  chiSquare: number | null;
  degreesFreedom: number;
  pValue: number | null;
  expectedBelowFive: number;
}

/** Regularized upper incomplete gamma Q(a, x), used for chi-square tail probabilities. */
function gammaQ(a: number, x: number): number {
  if (!(a > 0) || x < 0) return Number.NaN;
  if (x === 0) return 1;
  const logGamma = (z: number): number => {
    const coefficients = [676.5203681218851, -1259.1392167224028, 771.3234287776531,
      -176.6150291621406, 12.507343278686905, -0.13857109526572012,
      9.984369578019572e-6, 1.5056327351493116e-7];
    if (z < 0.5) return Math.log(Math.PI) - Math.log(Math.sin(Math.PI * z)) - logGamma(1 - z);
    z -= 1;
    let sum = 0.9999999999998099;
    coefficients.forEach((coef, i) => { sum += coef / (z + i + 1); });
    const t = z + coefficients.length - 0.5;
    return 0.5 * Math.log(2 * Math.PI) + (z + 0.5) * Math.log(t) - t + Math.log(sum);
  };
  const gln = logGamma(a);
  if (x < a + 1) {
    let term = 1 / a, sum = term, ap = a;
    for (let i = 0; i < 500; i++) {
      ap += 1; term *= x / ap; sum += term;
      if (Math.abs(term) < Math.abs(sum) * 1e-14) break;
    }
    const p = sum * Math.exp(-x + a * Math.log(x) - gln);
    return Math.max(0, Math.min(1, 1 - p));
  }
  let b = x + 1 - a, c = 1e300, d = 1 / b, h = d;
  for (let i = 1; i <= 500; i++) {
    const an = -i * (i - a);
    b += 2; d = an * d + b; if (Math.abs(d) < 1e-300) d = 1e-300;
    c = b + an / c; if (Math.abs(c) < 1e-300) c = 1e-300;
    d = 1 / d;
    const delta = d * c; h *= delta;
    if (Math.abs(delta - 1) < 1e-14) break;
  }
  return Math.max(0, Math.min(1, Math.exp(-x + a * Math.log(x) - gln) * h));
}

/** Pearson chi-square crosstab for two categorical variables, complete pairs only. */
export function crosstabChiSquare(rowValues: unknown[], columnValues: unknown[]): CrosstabResult {
  const rows = new Map<string, number>();
  const cols = new Map<string, number>();
  const pairs: Array<[string, string]> = [];
  const length = Math.min(rowValues.length, columnValues.length);
  for (let i = 0; i < length; i++) {
    const rv = rowValues[i], cv = columnValues[i];
    if (isMissing(rv) || isMissing(cv)) continue;
    const r = String(rv).trim(), c = String(cv).trim();
    if (!r || !c) continue;
    rows.set(r, (rows.get(r) || 0) + 1);
    cols.set(c, (cols.get(c) || 0) + 1);
    pairs.push([r, c]);
  }
  const rowLevels = Array.from(rows.keys()).sort((a, b) => a.localeCompare(b));
  const columnLevels = Array.from(cols.keys()).sort((a, b) => a.localeCompare(b));
  const cells = rowLevels.map(() => columnLevels.map(() => 0));
  const ri = new Map(rowLevels.map((v, i) => [v, i]));
  const ci = new Map(columnLevels.map((v, i) => [v, i]));
  for (const [r, c] of pairs) cells[ri.get(r)!][ci.get(c)!]++;
  const rowTotals = cells.map((r) => r.reduce((s, n) => s + n, 0));
  const columnTotals = columnLevels.map((_, j) => cells.reduce((s, r) => s + r[j], 0));
  const total = pairs.length;
  const degreesFreedom = Math.max(0, (rowLevels.length - 1) * (columnLevels.length - 1));
  let chiSquare = 0, expectedBelowFive = 0;
  if (degreesFreedom > 0 && total > 0) {
    for (let i = 0; i < rowLevels.length; i++) for (let j = 0; j < columnLevels.length; j++) {
      const expected = rowTotals[i] * columnTotals[j] / total;
      if (expected < 5) expectedBelowFive++;
      if (expected > 0) chiSquare += (cells[i][j] - expected) ** 2 / expected;
    }
  }
  return { rowLevels, columnLevels, cells, rowTotals, columnTotals, total,
    chiSquare: degreesFreedom > 0 && total > 0 ? chiSquare : null,
    degreesFreedom, pValue: degreesFreedom > 0 && total > 0 ? gammaQ(degreesFreedom / 2, chiSquare / 2) : null,
    expectedBelowFive };
}

