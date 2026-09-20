"""Module 05 — Correlation (Pearson, Spearman, matrix)."""
from __future__ import annotations

import numpy as np
import pandas as pd
from scipy import stats

from ..blocks import figure, num, pval, result, scatter_spec, table, text
from . import graphics


def correlate(df: pd.DataFrame, variables: list[str], method: str = "pearson") -> dict:
    d = df[variables].apply(pd.to_numeric, errors="coerce")
    n = len(d)
    k = len(variables)
    R = np.full((k, k), np.nan)
    P = np.full((k, k), np.nan)
    for i in range(k):
        for j in range(k):
            a, b = d[variables[i]], d[variables[j]]
            ok = a.notna() & b.notna()
            if ok.sum() >= 3 and i != j:
                fn = stats.pearsonr if method == "pearson" else stats.spearmanr
                r = fn(a[ok], b[ok])
                R[i, j] = R[j, i] = r.statistic if hasattr(r, "statistic") else r[0]
                P[i, j] = P[j, i] = r.pvalue if hasattr(r, "pvalue") else r[1]
            elif i == j:
                R[i, j] = 1.0
                P[i, j] = 0.0
    header = ["Variable"] + variables
    rows = []
    for i, v in enumerate(variables):
        rows.append([v] + [f"{R[i, j]:.3f}" + ("**" if P[i, j] < .01 else ("*" if P[i, j] < .05 else ""))
                           for j in range(k)])
    rows_p = []
    for i, v in enumerate(variables):
        rows_p.append([v] + ["" if i == j else pval(P[i, j]) for j in range(k)])
    blocks = [
        table(f"{method.capitalize()} correlation matrix (N={n})", header, rows,
              note="* p<0.05  ** p<0.01"),
        table("p-values", header, rows_p),
        figure("Scatter matrix (first pair preview)", scatter_spec(
            d[variables[0]], d[variables[-1]], title=f"{variables[0]} vs {variables[-1]}"))
        if k >= 2 else text(""),
    ]
    return result(f"Correlation ({method}): {', '.join(variables)}", blocks)


def corr_pair(df: pd.DataFrame, x: str, y: str) -> dict:
    d = df[[x, y]].apply(pd.to_numeric, errors="coerce").dropna()
    pr, pp = stats.pearsonr(d[x], d[y])
    sr, sp = stats.spearmanr(d[x], d[y])
    z = np.arctanh(pr)
    se = 1 / np.sqrt(len(d) - 3)
    lo, hi = np.tanh(z - 1.96 * se), np.tanh(z + 1.96 * se)
    r2 = pr ** 2
    rows = [
        ["Pearson", num(pr), f"[{num(lo)}, {num(hi)}]", num(r2), num(se, 4), pval(pp)],
        ["Spearman (ρ)", num(sr), "—", num(sr ** 2), "—", pval(sp)],
    ]
    blocks = [
        table(f"Correlation: {x} × {y} (N = {len(d)})",
              ["Method", "Coefficient", "95% CI", "r²", "SE(Fisher z)", "p"], rows),
        figure("Scatter plot", scatter_spec(df[x], df[y], title=f"{y} vs {x}")),
    ]
    return result(f"Correlation: {x} × {y}", blocks)
