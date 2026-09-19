"""Module 11 — Meta-analysis: fixed (IV) & random effects (DerSimonian-Laird),
heterogeneity, forest & funnel plots, Egger's test."""
from __future__ import annotations

import math

import numpy as np
import pandas as pd
from scipy import stats

from ..blocks import figure, num, pval, result, table, text


def meta(df: pd.DataFrame, effect_col: str, se_col: str, study_col: str | None = None,
         measure: str = "Effect") -> dict:
    d = df[[effect_col, se_col] + ([study_col] if study_col else [])].apply(
        pd.to_numeric, errors="coerce").dropna() if not study_col else \
        df[[effect_col, se_col, study_col]].dropna()
    theta = pd.to_numeric(d[effect_col], errors="coerce").to_numpy(float)
    se = pd.to_numeric(d[se_col], errors="coerce").to_numpy(float)
    ok = np.isfinite(theta) & np.isfinite(se) & (se > 0)
    theta, se = theta[ok], se[ok]
    k = len(theta)
    if k < 2:
        raise ValueError("Meta-analysis needs ≥2 studies with effect size and SE.")
    studies = d.loc[ok, study_col].astype(str).tolist() if study_col else [f"Study {i+1}" for i in range(k)]

    w = 1 / se ** 2
    theta_f = float((w * theta).sum() / w.sum())
    se_f = float(math.sqrt(1 / w.sum()))
    q = float((w * (theta - theta_f) ** 2).sum())
    dfree = k - 1
    p_q = float(1 - stats.chi2.cdf(q, dfree))
    i2 = max(0.0, (q - dfree) / q) * 100 if q > 0 else 0.0
    h = math.sqrt(max(q / dfree, 0.0))
    c = w.sum() - (w ** 2).sum() / w.sum()
    tau2 = max(0.0, (q - dfree) / c)
    w_r = 1 / (se ** 2 + tau2)
    theta_r = float((w_r * theta).sum() / w_r.sum())
    se_r = float(math.sqrt(1 / w_r.sum()))

    def ztest(est, see):
        z = est / see
        return z, float(2 * (1 - stats.norm.cdf(abs(z))))

    zf, pf = ztest(theta_f, se_f)
    zr, pr = ztest(theta_r, se_r)

    # per-study rows with 95% CI + weights
    rows = []
    for i, s in enumerate(studies):
        lo, hi = theta[i] - 1.96 * se[i], theta[i] + 1.96 * se[i]
        wr = 100 * w_r[i] / w_r.sum()
        rows.append([s, num(theta[i], 3), f"[{num(lo, 3)}, {num(hi, 3)}]", f"{wr:.1f}%"])
    rows.append(["Fixed effect (IV)", num(theta_f, 3),
                 f"[{num(theta_f - 1.96 * se_f, 3)}, {num(theta_f + 1.96 * se_f, 3)}]", "100%"])
    rows.append(["Random effects (DL)", num(theta_r, 3),
                 f"[{num(theta_r - 1.96 * se_r, 3)}, {num(theta_r + 1.96 * se_r, 3)}]", "100%"])

    hetero_lines = (f"Q({dfree}) = {q:.3f}, p = {pval(p_q)};  I² = {i2:.1f}%;  "
                    f"H = {h:.3f};  τ² = {tau2:.4f}")

    # forest plot data (frontend renders custom; we supply plotly)
    forest_y = list(range(k)) + [k + 1, k + 2]
    forest_x = theta.tolist() + [theta_f, theta_r]
    forest_lo = (theta - 1.96 * se).tolist() + [theta_f - 1.96 * se_f, theta_r - 1.96 * se_r]
    forest_hi = (theta + 1.96 * se).tolist() + [theta_f + 1.96 * se_f, theta_r + 1.96 * se_r]
    colors = ["#334155"] * k + ["#0ea5e9", "#f97316"]
    forest = {
        "type": "forest",
        "points": [{"study": s, "effect": float(theta[i]) if i < k else None,
                    "lo": None, "hi": None} for i, s in enumerate(studies)],
        "rows": [
            {"label": s, "effect": float(theta[i]), "lo": float(theta[i] - 1.96 * se[i]),
             "hi": float(theta[i] + 1.96 * se[i]), "kind": "study"} for i, s in enumerate(studies)
        ] + [
            {"label": "Fixed effect (IV)", "effect": theta_f, "lo": theta_f - 1.96 * se_f,
             "hi": theta_f + 1.96 * se_f, "kind": "fixed"},
            {"label": "Random effects (DL)", "effect": theta_r, "lo": theta_r - 1.96 * se_r,
             "hi": theta_r + 1.96 * se_r, "kind": "random"},
        ],
        "xlabel": measure,
    }
    # funnel plot
    funnel = {
        "data": [
            {"type": "scatter", "mode": "markers", "x": theta.tolist(), "y": se.tolist(),
             "marker": {"color": "#0ea5e9", "size": 7}, "name": "studies"},
            {"type": "scatter", "mode": "lines", "name": "pseudo 95% CI",
             "x": [theta_r - 1.96 * float(se.max()), theta_r, theta_r + 1.96 * float(se.max()),
                   theta_r + 1.96 * float(se.max()), theta_r, theta_r - 1.96 * float(se.max()),
                   theta_r - 1.96 * float(se.max())],
             "y": [float(se.max()), 0, float(se.max()), float(se.max()), 0, float(se.max()), float(se.max())],
             "line": {"color": "#94a3b8", "width": 1, "dash": "dash"}, "fill": "toself",
             "fillcolor": "rgba(148,163,184,0.08)", "showlegend": False},
            {"type": "scatter", "mode": "lines", "x": [theta_r, theta_r], "y": [0, float(se.max())],
             "line": {"color": "#f97316", "width": 1.5, "dash": "dot"}, "name": "pooled"},
        ],
        "layout": {
            "paper_bgcolor": "white", "plot_bgcolor": "white",
            "font": {"family": "Inter, system-ui, sans-serif", "size": 12, "color": "#334155"},
            "margin": {"l": 60, "r": 30, "t": 50, "b": 60},
            "title": {"text": "Funnel plot (publication bias)"},
            "xaxis": {"title": {"text": measure}, "gridcolor": "#e2e8f0"},
            "yaxis": {"title": {"text": "Standard error"}, "autorange": "reversed", "gridcolor": "#e2e8f0"},
        },
    }

    # Egger's test: theta_i / se_i  ~ a + b * (1/se_i)
    egger_p = float("nan")
    egger_b = float("nan")
    if k >= 3:
        x = 1 / se
        y = theta / se
        sl, ic, r, pv, _ = stats.linregress(x, y)
        egger_p = pv
        egger_b = ic
    blocks = [
        table(f"Meta-analysis ({k} studies) — {measure}",
              ["Study", measure, "95% CI", "Random-expr. weight"], rows),
        text(f"<b>Heterogeneity</b>: {hetero_lines}"),
        text(f"<b>Fixed effect (IV)</b>: {num(theta_f, 3)}  (SE {se_f:.4f})  z = {zf:.3f}, p = {pval(pf)}<br>"
             f"<b>Random effects (DL)</b>: {num(theta_r, 3)}  (SE {se_r:.4f})  z = {zr:.3f}, p = {pval(pr)}<br>"
             f"95% CI (fixed): [{num(theta_f - 1.96 * se_f, 3)}, {num(theta_f + 1.96 * se_f, 3)}]; "
             f"95% CI (random): [{num(theta_r - 1.96 * se_r, 3)}, {num(theta_r + 1.96 * se_r, 3)}]"),
        figure("Forest plot", {"_custom": "forest", "payload": forest}),
        figure("Funnel plot", funnel),
        text(f"Egger's regression intercept = {num(egger_b, 3)}, p = {pval(egger_p)} "
             f"({'small-study effects suggested' if (not math.isnan(egger_p)) and egger_p < .05 else 'no strong asymmetry evidence'})"),
    ]
    return result(f"Meta-analysis — {measure} ({k} studies)", blocks)
