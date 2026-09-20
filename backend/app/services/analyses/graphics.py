"""Module 13 — Graphics (histogram, boxplot, bar chart, scatter)."""
from __future__ import annotations

import pandas as pd

from ..blocks import figure, result, table, text
from .. import blocks as B


def histogram(df: pd.DataFrame, var: str, bins: int = 20, by: str | None = None) -> dict:
    s = pd.to_numeric(df[var], errors="coerce")
    blocks = [figure("Histogram", B.hist_spec(s, bins=bins))]
    if by:
        for g in df[by].dropna().unique():
            sub = s[df[by] == g]
            blocks.append(figure(f"Histogram — {by} = {g}", B.hist_spec(sub, bins=bins,
                                                                        title=f"{var} — {by}={g}")))
    return result(f"Histogram: {var}", blocks)


def boxplot(df: pd.DataFrame, var: str, by: str | None = None) -> dict:
    s = pd.to_numeric(df[var], errors="coerce")
    bys = df[by] if by else None
    blocks = [figure("Box plot", B.box_spec(s, bys))]
    if by:
        rows = []
        for g in df[by].dropna().unique():
            sub = s[df[by] == g].dropna()
            if sub.empty:
                continue
            q1, q3 = sub.quantile(0.25), sub.quantile(0.75)
            rows.append([str(g), len(sub), num(sub.mean()), num(sub.std(ddof=1)), num(sub.median()),
                         num(q1), num(q3), num(sub.min()), num(sub.max())])
        if rows:
            blocks.append(table(f"Box plot summary — {var} by {by}",
                                [by, "N", "Mean", "SD", "Median", "P25", "P75", "Min", "Max"], rows))
    return result(f"Box plot: {var}", blocks)


def barchart(df: pd.DataFrame, var: str, by: str | None = None, stat: str = "count") -> dict:
    if by:
        g = df.groupby(by)[var]
        if stat == "mean":
            counts = g.mean().dropna().to_dict()
            blocks = [figure(f"Mean {var} by {by}", B.bar_spec(counts, title=f"Mean of {var} by {by}", ylabel="Mean"))]
        elif stat == "sum":
            counts = g.sum(numeric_only=True).dropna().to_dict()
            blocks = [figure(f"Sum of {var} by {by}", B.bar_spec(counts, title=f"Sum of {var} by {by}", ylabel="Sum"))]
        else:
            counts = g.size().to_dict()
            blocks = [figure(f"Count by {by}", B.bar_spec(counts, title=f"Counts by {by}"))]
    else:
        vc = df[var].astype("object").value_counts().head(30)
        blocks = [figure("Bar chart", B.bar_spec({str(k): v for k, v in vc.items()}))]
    return result(f"Bar chart: {var}", blocks)


def scatter(df: pd.DataFrame, x: str, y: str, by: str | None = None) -> dict:
    blocks = []
    if by:
        for g in df[by].dropna().unique():
            sub = df[df[by] == g]
            blocks.append(figure(f"{y} vs {x} — {by}={g}", B.scatter_spec(sub[x], sub[y],
                                                                         title=f"{y} vs {x} ({g})")))
    else:
        blocks.append(figure("Scatter plot", B.scatter_spec(df[x], df[y])))
    return result(f"Scatter: {y} vs {x}", blocks)
