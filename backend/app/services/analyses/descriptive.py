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
    if fisher and ct.shape == (2, 2):
        odds, p = __import__("scipy").stats.fisher_exact(ct.values)
        stat_lines.append(f"Fisher exact p = {pval(p)};  odds ratio (2×2) = {num(odds)}")
    if stat_lines:
        blocks.append(text("<br>".join(stat_lines)))
    return result(f"Crosstab: {row} × {col}", blocks)
