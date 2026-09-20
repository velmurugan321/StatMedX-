"""Module 08 — ROC curves: AUC, Hanley-McNeil SE & CI, optimal threshold table,
and bootstrap comparison of two correlated ROC curves."""
from __future__ import annotations

import math

import numpy as np
import pandas as pd

from ..blocks import figure, num, pval, result, table, text


def roc_curve(y: np.ndarray, score: np.ndarray):
    """Descending-threshold ROC. Returns (fpr, tpr, thresholds)."""
    order = np.argsort(-score)
    y = y[order]
    score = score[order]
    tp = cum_pos = np.cumsum(y == 1)
    fp = cum_neg = np.cumsum(y == 0)
    p_total = max((y == 1).sum(), 1)
    n_total = max((y == 0).sum(), 1)
    distinct = np.where(np.diff(np.concatenate(([score[0] + 1], score))))[0]
    tpr = np.concatenate(([0.0], tp[distinct] / p_total))
    fpr = np.concatenate(([0.0], fp[distinct] / n_total))
    thr = np.concatenate(([score[0] + 1], score[distinct]))
    return fpr, tpr, thr


def auc_se_hanley(y: np.ndarray, score: np.ndarray) -> tuple[float, float]:
    fpr, tpr, _ = roc_curve(y, score)
    # trapezoid over curve (numpy ≥2: trapezoid; older: trapz)
    _trapz = getattr(np, "trapezoid", None) or np.trapz
    auc = float(_trapz(tpr, fpr))
    n1 = (y == 1).sum()
    n0 = (y == 0).sum()
    if n1 == 0 or n0 == 0 or auc in (0.0, 1.0):
        return auc, float("nan")
    q1 = auc / (2 - auc)
    q2 = 2 * auc * auc / (1 + auc)
    var = (auc * (1 - auc) + (n1 - 1) * (q1 - auc ** 2) + (n0 - 1) * (q2 - auc ** 2)) / (n1 * n0)
    return auc, math.sqrt(max(var, 0.0))


def _full(y, score, name: str) -> dict:
    fpr, tpr, thr = roc_curve(y, score)
    auc, se = auc_se_hanley(y, score)
    lo = max(0.0, auc - 1.96 * se) if not math.isnan(se) else float("nan")
    hi = min(1.0, auc + 1.96 * se) if not math.isnan(se) else float("nan")
    n = len(y)
    fig = {
        "data": [
            {"type": "scatter", "mode": "lines", "x": fpr.tolist(), "y": tpr.tolist(),
             "line": {"color": "#0ea5e9", "width": 2.5}, "name": f"{name} (AUC={auc:.3f})",
             "fill": "tozeroy", "fillcolor": "rgba(14,165,233,0.08)"},
            {"type": "scatter", "mode": "lines", "x": [0, 1], "y": [0, 1],
             "line": {"color": "#94a3b8", "width": 1, "dash": "dash"},
             "showlegend": False},
        ],
        "layout": {
            **{"paper_bgcolor": "white", "plot_bgcolor": "white",
               "font": {"family": "Inter, system-ui, sans-serif", "size": 12, "color": "#334155"},
               "margin": {"l": 60, "r": 30, "t": 50, "b": 60},
               "legend": {"orientation": "h", "y": -0.25}},
            "title": {"text": f"ROC curve — {name}"},
            "xaxis": {"title": {"text": "1 − Specificity (FPR)"}, "range": [-0.02, 1.02], "gridcolor": "#e2e8f0"},
            "yaxis": {"title": {"text": "Sensitivity (TPR)"}, "range": [-0.02, 1.02], "gridcolor": "#e2e8f0"},
        },
    }
    return {"fpr": fpr, "tpr": tpr, "thr": thr, "auc": auc, "se": se, "lo": lo, "hi": hi,
            "n": n, "fig": fig, "name": name}


def _threshold_table(y: np.ndarray, score: np.ndarray, name: str) -> list[list]:
    rows = []
    p_total = max((y == 1).sum(), 1)
    n_total = max((y == 0).sum(), 1)
    order = np.argsort(-score)
    ys, ss = y[order], score[order]
    best_j, best_yd = None, -1
    uniq_idx = np.where(np.diff(np.concatenate(([ss[0] + 1], ss))))[0]
    for k in uniq_idx:
        thr = ss[k]
        tp = int(((score >= thr) & (y == 1)).sum())
        fp = int(((score >= thr) & (y == 0)).sum())
        fn = int(((score < thr) & (y == 1)).sum())
        tn = int(((score < thr) & (y == 0)).sum())
        sens = tp / p_total
        spec = tn / n_total
        ppv = tp / (tp + fp) if tp + fp else float("nan")
        npv = tn / (tn + fn) if tn + fn else float("nan")
        yd = sens + spec - 1
        dist = math.hypot(1 - sens, 0 - (1 - spec))
        if yd > best_yd:
            best_yd, best_j = yd, thr
        rows.append([num(thr, 2), tp, fp, fn, tn, f"{sens:.3f}", f"{spec:.3f}",
                     num(ppv, 3), num(npv, 3), f"{yd:.3f}", f"{dist:.3f}"])
    return rows


def roc_analysis(df: pd.DataFrame, y_var: str, score_vars: list[str], thresholds: bool = True) -> dict:
    d = df[[y_var] + score_vars].apply(pd.to_numeric, errors="coerce").dropna()
    y = d[y_var].to_numpy()
    if not set(np.unique(y)) <= {0, 1}:
        raise ValueError(f"ROC outcome must be 0/1 (found {sorted(set(np.unique(y)))})")
    blocks = []
    figs = []
    aucs = []
    for sv in score_vars:
        f = _full(y, d[sv].to_numpy(), sv)
        aucs.append(f)
        figs.append(f["fig"])
        blocks.append(text(
            f"<b>{sv}</b>: AUC = {f['auc']:.4f}  (SE = {f['se']:.4f}, 95% CI [{f['lo']:.4f}, {f['hi']:.4f}]), "
            f"N = {f['n']} ({int((y==1).sum())} cases / {int((y==0).sum())} controls)"))
    fig = {"data": [tr for f in figs for tr in f["data"]],
           "layout": {**figs[0]["layout"],
                      "title": {"text": "ROC curve" + ("s" if len(figs) > 1 else "")},
                      "showlegend": len(figs) > 1}}
    blocks.append(figure("ROC plot", fig))
    if thresholds and len(score_vars) == 1:
        sv = score_vars[0]
        rows = _threshold_table(y, d[sv].to_numpy(), sv)
        blocks.append(table(f"Threshold table — {sv}",
                            ["Cutpoint", "TP", "FP", "FN", "TN", "Sens", "Spec", "PPV", "NPV",
                             "Youden J", "Dist (0,1)"], rows[:25],
                            note="Top 25 cut-points by descending score; Youden J = Sens+Spec−1 (max = optimal)"))
        # optimal via Youden on the full grid
        fpr, tpr, thr = roc_curve(y, d[sv].to_numpy())
        j = tpr - fpr
        i = int(np.argmax(j))
        blocks.append(text(f"<b>Optimal cut-point (Youden)</b>: {thr[i]:.3f} → Sens {tpr[i]:.3f}, "
                           f"Spec {1 - fpr[i]:.3f}, J = {j[i]:.3f}"))
    if len(score_vars) == 2:
        a1, a2 = aucs[0]["auc"], aucs[1]["auc"]
        rng = np.random.default_rng(42)
        diffs = []
        yv = y
        idx = np.arange(len(yv))
        for _ in range(500):
            samp = rng.choice(idx, size=len(idx), replace=True)
            ys = yv[samp]
            if len(np.unique(ys)) < 2:
                continue
            from .roc import auc_se_hanley as _a
            a1b = _a(ys, d[score_vars[0]].to_numpy()[samp])[0]
            a2b = _a(ys, d[score_vars[1]].to_numpy()[samp])[0]
            diffs.append(a1b - a2b)
        if diffs:
            diffs = np.array(diffs)
            se_d = diffs.std(ddof=1)
            z = (a1 - a2) / se_d if se_d else np.nan
            p = 2 * (1 - _norm_cdf(abs(z))) if not math.isnan(z) else float("nan")
            blocks.append(text(
                f"<b>Comparison of AUCs</b>: {score_vars[0]} − {score_vars[1]} = {a1 - a2:.4f} "
                f"(bootstrap SE = {se_d:.4f}, 95% CI [{np.percentile(diffs,2.5):.4f}, {np.percentile(diffs,97.5):.4f}]), "
                f"z = {z:.3f}, p = {pval(p)}"))
    return result(f"ROC analysis — outcome {y_var}", blocks)


def _norm_cdf(z: float) -> float:
    return 0.5 * (1 + math.erf(z / math.sqrt(2)))
