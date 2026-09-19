"""Module 03 — Descriptive statistics."""
from __future__ import annotations

import numpy as np
import pandas as pd
from scipy import stats

from ..blocks import figure, num, pval, result, table, text
from . import graphics


def summarize(df: pd.DataFrame, variables: list[str], detail: bool = False) -> dict:
    blocks = [text(f"<b>Summary statistics</b> — N = {len(df)} observations")]
    rows = []
    for v in variables:
        s = pd.to_numeric(df[v], errors="coerce").dropna()
        if s.empty:
            rows.append([v, 0, 0, "", "", "", "", "", "", ""])
            continue
        mean, sd = s.mean(), s.std(ddof=1)
        med = s.median()
        q1, q3 = s.quantile(0.25), s.quantile(0.75)
        rows.append([
            v, len(s), float(s.min()), float(s.max()), num(mean), num(sd),
            num(s.std(ddof=1) / np.sqrt(len(s))),  # SE
            num(med), num(q1), num(q3),
        ])
    blocks.append(table("Summary statistics",
                        ["Variable", "N", "Min", "Max", "Mean", "SD", "SE", "Median", "P25", "P75"],
                        rows,
                        note="SD = standard deviation; SE = standard error of mean"))
    if detail:
        drows = []
        for v in variables:
            s = pd.to_numeric(df[v], errors="coerce").dropna()
            if s.empty:
                continue
            sk = stats.skew(s, bias=False)
            ku = stats.kurtosis(s, bias=False)  # excess
            sw = stats.shapiro(s) if 3 <= len(s) <= 5000 else (None, None)
            pcts = np.percentile(s, [1, 5, 10, 25, 50, 75, 90, 95, 99])
            drows.append([
                v, num(sk, 2), num(ku, 2),
                num(pcts[0], 2), num(pcts[1], 2), num(pcts[2], 2), num(pcts[3], 2), num(pcts[4], 2),
                num(pcts[5], 2), num(pcts[6], 2), num(pcts[7], 2), num(pcts[8], 2),
                pval(sw[1]) if sw[0] is not None else "",
            ])
        if drows:
            blocks.append(table("Detail statistics",
                                ["Variable", "Skewness", "Kurtosis", "P1", "P5", "P10", "P25", "P50",
                                 "P75", "P90", "P95", "P99", "Shapiro-W p"],
                                drows,
                                note="Shapiro-Wilk p>0.05 suggests approximate normality (n≤5000)"))
    return result("Descriptive statistics", blocks)


def frequencies(df: pd.DataFrame, variables: list[str]) -> dict:
    blocks = []
    for v in variables:
        s = df[v]
        vc = s.astype("object").where(s.notna(), "(missing)").value_counts()
        cum = 0.0
        rows = []
        for val, cnt in vc.items():
            pct = 100 * cnt / len(s)
            cum += pct
            rows.append([str(val), int(cnt), f"{pct:.1f}", f"{cum:.1f}"])
        blocks.append(table(f"Frequency table — {v}",
                            [v, "Frequency", "Percent", "Cumulative %"], rows))
    return result("Frequency tables", blocks)


def fisher_rc(ct) -> float:
    """Two-sided Fisher exact p for an r×c table: full enumeration of tables with
    the observed margins, probability ordering p_t ≤ p_obs (identical to
    R's fisher.test and Stata's tabulate, exact)."""
    from math import lgamma, exp

    ct = np.asarray(ct, dtype=np.int64)
    r, c = ct.shape
    n_rows = ct.sum(axis=1)
    n_cols = ct.sum(axis=0)
    n_total = int(ct.sum())
    lrow = [lgamma(v + 1) for v in n_rows]
    lcol = [lgamma(v + 1) for v in n_cols]
    ln_fact_total = lgamma(n_total + 1)

    def log_prob(table):
        # p(table) = [Π row_i! · Π col_j!] / [N! · Π x_ij!]  (multivariate hypergeometric)
        s = sum(lrow) + sum(lcol) - ln_fact_total
        for rowv in table:
            for cell in rowv:
                s -= lgamma(cell + 1)
        return s

    tables = []

    def allocate(j, remaining_rows, acc):
        if j == c - 1:
            if all(rr >= 0 for rr in remaining_rows):
                # transpose column-allocations → row-major table
                tables.append([[acc[jj][i] for jj in range(len(acc))] + [remaining_rows[i]]
                               for i in range(r)])
            return
        target = int(n_cols[j])

        def spread(i, left, row_acc):
            if i == r - 1:
                if 0 <= left <= remaining_rows[i]:
                    spread_next = list(row_acc) + [left]
                    new_rows = [rr - v for rr, v in zip(remaining_rows, spread_next)]
                    allocate(j + 1, new_rows, acc + [spread_next])
                return
            for v in range(0, min(left, remaining_rows[i]) + 1):
                spread(i + 1, left - v, row_acc + [v])

        spread(0, target, [])

    allocate(0, [int(v) for v in n_rows], [])
    if len(tables) > 2_000_000:
        return float("nan")
    log_probs = [log_prob(t) for t in tables]
    m = max(log_probs)
    probs = [exp(lp - m) for lp in log_probs]
    z = sum(probs)
    probs = [p_ / z for p_ in probs]
    obs_list = [[int(v) for v in row] for row in ct.tolist()]
    idx = next(i for i, t in enumerate(tables) if t == obs_list)
    p_obs = probs[idx]
    return float(sum(p_ for i, p_ in enumerate(probs) if p_ <= p_obs * (1 + 1e-7)))


def crosstab(df: pd.DataFrame, row: str, col: str, chi2: bool = False, fisher: bool = False, percent: bool = True):
    """Crosstab with optional chi-square / Fisher (also used by Module 04 tests)."""
    ct = pd.crosstab(df[row].astype("object"), df[col].astype("object"))
    blocks = []
    colnames = [str(c) for c in ct.columns]
    header = [row + " \\ " + col] + [f"{c}" for c in colnames] + ["Total"]
    rows = []
    for idx_name, r in ct.iterrows():
        rows.append([str(idx_name)] + [int(x) for x in r.values] + [int(r.sum())])
    rows.append(["Total"] + [int(x) for x in ct.sum(axis=0).values] + [int(ct.values.sum())])
    blocks.append(table(f"Crosstab {row} × {col}", header, rows))
    if percent:
        pct = pd.crosstab(df[row].astype("object"), df[col].astype("object"), normalize="index") * 100
        rows2 = []
        for idx_name, r in pct.iterrows():
            rows2.append([str(idx_name)] + [f"{v:.1f}%" for v in r.values])
        blocks.append(table("Row percentages", header[:-1], rows2))
    stat_lines = []
    if chi2:
        chi, p, dof, expected = __import__("scipy").stats.chi2_contingency(ct)
        cells_lt5 = int((expected < 5).sum())
        stat_lines.append(f"Pearson χ²({dof}) = {chi:.3f}, p = {pval(p)}   "
                          f"(cells with expected <5: {cells_lt5}/{expected.size})")
        lr = __import__("scipy").stats.chi2_contingency(ct, lambda_="log-likelihood")
        stat_lines.append(f"Likelihood-ratio χ²({lr[2]}) = {lr[0]:.3f}, p = {pval(lr[1])}")
    if fisher:
        if ct.shape == (2, 2):
            odds, p = __import__("scipy").stats.fisher_exact(ct.values)
            stat_lines.append(f"Fisher exact p = {pval(p)};  odds ratio (2×2) = {num(odds)}")
        else:
            p_rc = fisher_rc(ct.values)
            stat_lines.append(f"Fisher exact p = {pval(p_rc)} (r×c, full enumeration)")
    if stat_lines:
        blocks.append(text("<br>".join(stat_lines)))
    return result(f"Crosstab: {row} × {col}", blocks)
