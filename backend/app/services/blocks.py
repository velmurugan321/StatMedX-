"""Common result-block helpers shared by every analysis module.

A result is: {"title": str, "command": str|None, "blocks": [...]}
block types:
  {"type": "text",  "content": str}
  {"type": "table", "name": str, "columns": [{"key","label","align"?}], "rows": [[...]], "note": str?}
  {"type": "figure", "name": str, "spec": {plotly figure dict}}
  {"type": "code",  "content": str}
"""
from __future__ import annotations

import numpy as np
import pandas as pd


def pval(p: float) -> str:
    if p is None or (isinstance(p, float) and np.isnan(p)):
        return ""
    if p < 1e-4:
        return "<0.0001"
    return f"{p:.4f}"


def num(x, digits: int | None = 3) -> str:
    if x is None:
        return ""
    try:
        x = float(x)
    except (TypeError, ValueError):
        return str(x)
    if np.isnan(x) or np.isinf(x):
        return "" if np.isnan(x) else ("∞" if x > 0 else "−∞")
    if digits is None:
        return f"{x:,.6g}"
    if x == int(x) and abs(x) < 1e15:
        return f"{x:,.0f}"
    return f"{x:,.{digits}f}"


def text(content: str) -> dict:
    return {"type": "text", "content": content}


def code(content: str) -> dict:
    return {"type": "code", "content": content}


def table(name: str, columns: list[str], rows: list[list], note: str = "") -> dict:
    return {
        "type": "table",
        "name": name,
        "columns": [{"key": c, "label": c} for c in columns],
        "rows": rows,
        "note": note,
    }


def figure(name: str, spec: dict) -> dict:
    return {"type": "figure", "name": name, "spec": spec}


def result(title: str, blocks: list[dict], command: str | None = None) -> dict:
    return {"title": title, "command": command, "blocks": blocks}


# ---------- plotly figure builders (dict-only; plotly.js renders on the frontend) ----------
LAYOUT_BASE = {
    "paper_bgcolor": "white",
    "plot_bgcolor": "white",
    "font": {"family": "Inter, system-ui, sans-serif", "size": 12, "color": "#334155"},
    "margin": {"l": 60, "r": 30, "t": 50, "b": 60},
    "xaxis": {"gridcolor": "#e2e8f0", "zerolinecolor": "#cbd5e1"},
    "yaxis": {"gridcolor": "#e2e8f0", "zerolinecolor": "#cbd5e1"},
    "legend": {"orientation": "h", "y": -0.2},
}


def layout(**over):
    lay = {**LAYOUT_BASE}
    for k, v in over.items():
        if isinstance(v, dict) and isinstance(lay.get(k), dict):
            lay[k] = {**lay[k], **v}
        else:
            lay[k] = v
    return lay


def hist_spec(s: pd.Series, bins: int = 20, title: str = ""):
    x = s.dropna().astype(float)
    fig = {
        "data": [{"type": "histogram", "x": x.tolist(), "nbinsx": bins,
                  "marker": {"color": "#0ea5e9", "line": {"color": "#0284c7", "width": 1}}}],
        "layout": layout(title=title or f"Distribution of {s.name}",
                         xaxis={"title": {"text": str(s.name)}},
                         yaxis={"title": {"text": "Frequency"}}),
    }
    return fig


def box_spec(s: pd.Series, by: pd.Series | None = None, title: str = ""):
    if by is not None:
        groups, names = [], []
        for g in by.dropna().unique():
            mask = by == g
            groups.append(s[mask].dropna().astype(float).tolist())
            names.append(str(g))
        data = [{"type": "box", "y": g, "name": n, "marker": {"color": "#0ea5e9"}} for g, n in zip(groups, names)]
    else:
        data = [{"type": "box", "y": s.dropna().astype(float).tolist(), "name": str(s.name),
                 "marker": {"color": "#0ea5e9"}}]
    return {"data": data, "layout": layout(title=title or f"Box plot of {s.name}",
                                           yaxis={"title": {"text": str(s.name)}})}


def bar_spec(counts: dict, title: str = "", ylabel: str = "Count"):
    labels = [str(k) for k in counts]
    vals = [float(v) for v in counts.values()]
    return {"data": [{"type": "bar", "x": labels, "y": vals,
                      "marker": {"color": "#0ea5e9", "line": {"color": "#0369a1", "width": 1}}}],
            "layout": layout(title=title or "Bar chart",
                             xaxis={"title": {"text": ""}}, yaxis={"title": {"text": ylabel}})}


def scatter_spec(x: pd.Series, y: pd.Series, title: str = "", trend: bool = True):
    mask = x.notna() & y.notna()
    xv = pd.to_numeric(x[mask], errors="coerce")
    yv = pd.to_numeric(y[mask], errors="coerce")
    ok = xv.notna() & yv.notna()
    xv, yv = xv[ok], yv[ok]
    data = [{"type": "scatter", "mode": "markers", "x": xv.tolist(), "y": yv.tolist(),
             "marker": {"color": "#0ea5e9", "size": 6, "opacity": 0.7}, "name": "observations"}]
    if trend and len(xv) > 2:
        b, a = np.polyfit(xv, yv, 1)
        xs = [float(xv.min()), float(xv.max())]
        data.append({"type": "scatter", "mode": "lines", "x": xs, "y": [a + b * v for v in xs],
                     "line": {"color": "#f97316", "width": 2, "dash": "dash"}, "name": "fit"})
    return {"data": data, "layout": layout(title=title or f"{y.name} vs {x.name}",
                                           xaxis={"title": {"text": str(x.name)}},
                                           yaxis={"title": {"text": str(y.name)}})}
