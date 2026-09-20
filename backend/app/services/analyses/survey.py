"""Module 10 — Complex survey analysis (Taylor-series linearization).

Design: weights (+ optional strata and PSU/cluster variables).
Estimates: weighted means, weighted proportions, weighted (survey) linear and
logistic regression with design-based (linearized) standard errors.

Variance of a total:  V = Σ_h  n_h/(n_h−1)  Σ_i (U_hi − Ū_h)²
where U_hi are PSU totals of the linearized variable and h indexes strata.
Design df = (#PSUs − #strata). Singleton strata contribute 0 variance and are
reported as a warning. For the mean, z = w(y − θ̂) is linearized; for
regression the sandwich B⁻¹MB uses the weighted score and (for logit) the
weighted information bread.
"""
from __future__ import annotations

import numpy as np
import pandas as pd
import statsmodels.api as sm
from scipy import stats

from ..blocks import num, pval, result, table, text


def _codes(d: pd.DataFrame, col: str | None):
    if col is None:
        return np.zeros(len(d), dtype=int)
    return d[col].astype("category").cat.codes.to_numpy()


def _design(d: pd.DataFrame, strata_col: str | None, psu_col: str | None):
    h = _codes(d, strata_col)
    i = _codes(d, psu_col) if psu_col is not None else np.arange(len(d))
    # unique (h, i) pairs — but codes collide across strata, so combine
    hi = pd.DataFrame({"h": h, "i": i}).drop_duplicates()
    n_strata = int(hi["h"].nunique())
    n_psu = len(hi)
    dfree = n_psu - n_strata
    singletons = 0
    for _, grp in hi.groupby("h"):
        if len(grp) < 2:
            singletons += 1
    return h, i, n_strata, n_psu, dfree, singletons


def _var_total(z: np.ndarray, h: np.ndarray, i: np.ndarray) -> tuple[float, int]:
    dfu = pd.DataFrame({"h": h, "i": i, "z": z})
    g = dfu.groupby(["h", "i"], sort=True)["z"].sum()
    dfu2 = g.reset_index()
    var = 0.0
    singletons = 0
    for hh, grp in dfu2.groupby("h"):
        nh = len(grp)
        if nh < 2:
            singletons += 1
            continue
        c = nh / (nh - 1)
        ub = grp["z"].mean()
        var += c * float(((grp["z"] - ub) ** 2).sum())
    return var, singletons


def _prep(df: pd.DataFrame, cols: list[str], weight: str, strata: str | None, psu: str | None,
          numeric_cols: list[str]):
    d = df[cols].copy()
    for c in numeric_cols:
        d[c] = pd.to_numeric(d[c], errors="coerce")
    d = d.replace([np.inf, -np.inf], np.nan).dropna()
    if (d[weight] <= 0).any():
        d = d[d[weight] > 0]
    return d


def _design_note(n: int, n_strata: int, n_psu: int, dfree: int, singletons: int, w: np.ndarray):
    lines = [f"N = {n}; strata = {n_strata}; PSUs = {n_psu}; design df = {dfree}; "
             f"weight sum = {w.sum():,.1f} (min {w.min():.3g}, max {w.max():.3g})"]
    if singletons:
        lines.append(f"⚠ {singletons} singleton stratum/strata — contribute no variance; "
                     "consider collapsing them.")
    if dfree < 1:
        lines.append("⚠ design df < 1: add PSUs/clusters or remove strata for valid inference.")
    return "<br>".join(lines)


def survey_mean(df: pd.DataFrame, var_col: str, weight: str,
                strata: str | None = None, psu: str | None = None) -> dict:
    cols = [c for c in [var_col, weight, strata, psu] if c]
    d = _prep(df, cols, weight, strata, psu, [var_col, weight])
    w = d[weight].to_numpy(float)
    y = d[var_col].to_numpy(float)
    h, i, n_strata, n_psu, dfree, singletons = _design(d, strata, psu)
    W = w.sum()
    theta = float((w * y).sum() / W)
    z = w * (y - theta)
    var_tot, _s = _var_total(z, h, i)
    se = float(np.sqrt(var_tot)) / W
    # design effects
    s2 = float(y.var(ddof=1))
    deff = (se ** 2) / (s2 / len(y)) if s2 > 0 else float("nan")
    tcrit = stats.t.ppf(0.975, dfree) if dfree >= 1 else float("nan")
    tval = theta / se if se else float("nan")
    pv = float(2 * (1 - stats.t.cdf(abs(tval), dfree))) if dfree >= 1 else float("nan")
    blocks = [
        table(f"Survey-weighted mean of {var_col}",
              ["Estimate", "Std. err.", "95% CI", "t (vs 0)", "p", "n", "DEFF"],
              [[num(theta), num(se),
                f"[{num(theta - tcrit * se)}, {num(theta + tcrit * se)}]",
                num(tval), pval(pv), len(d), num(deff, 2)]]),
        text(_design_note(len(d), n_strata, n_psu, dfree, singletons, w)),
    ]
    return result(f"Survey mean: {var_col}", blocks)


def survey_prop(df: pd.DataFrame, var_col: str, weight: str,
                strata: str | None = None, psu: str | None = None) -> dict:
    cols = [c for c in [var_col, weight, strata, psu] if c]
    d = df[cols].copy()
    d[weight] = pd.to_numeric(d[weight], errors="coerce")
    d = d.dropna()
    d = d[d[weight] > 0]
    d[var_col] = d[var_col].astype("object")
    w_all = d[weight].to_numpy(float)
    h, i, n_strata, n_psu, dfree, singletons = _design(d, strata, psu)
    W = w_all.sum()
    levels = sorted(d[var_col].astype(str).unique(), key=str)
    rows = []
    for lv in levels:
        ind = (d[var_col].astype(str) == lv).to_numpy(float)
        pk = float((w_all * ind).sum() / W)
        z = w_all * (ind - pk)
        vt, _ = _var_total(z, h, i)
        se = float(np.sqrt(vt)) / W
        tcrit = stats.t.ppf(0.975, dfree) if dfree >= 1 else float("nan")
        deff = (se ** 2) / (pk * (1 - pk) / len(d)) if 0 < pk < 1 else float("nan")
        n_k = int(ind.sum())
        rows.append([lv, n_k, num(w_all[ind == 1].sum()), f"{100 * pk:.2f}%",
                     num(se * 100, 2) + "%",
                     f"[{100 * max(0, pk - tcrit * se):.2f}%, {100 * min(1, pk + tcrit * se):.2f}%]",
                     num(deff, 2)])
    blocks = [
        table(f"Survey-weighted proportions of {var_col}",
              ["Category", "n unweighted", "Weighted size", "Proportion %", "SE %", "95% CI", "DEFF"],
              rows),
        text(_design_note(len(d), n_strata, n_psu, dfree, singletons, w_all)),
    ]
    return result(f"Survey proportions: {var_col}", blocks)


def survey_reg(df: pd.DataFrame, y: str, xs: list[str], weight: str,
               strata: str | None = None, psu: str | None = None,
               family: str = "gaussian") -> dict:
    cols = [y] + xs + [weight] + [c for c in [strata, psu] if c]
    d = df[cols].copy()
    for c in [y] + xs + [weight]:
        d[c] = pd.to_numeric(d[c], errors="coerce")
    d = d.replace([np.inf, -np.inf], np.nan).dropna()
    d = d[d[weight] > 0]
    w = d[weight].to_numpy(float)
    Y = d[y].to_numpy(float)
    X = sm.add_constant(d[xs].astype(float), has_constant="add")
    X = np.asarray(X, dtype=float)
    h, i, n_strata, n_psu, dfree, singletons = _design(d, strata, psu)

    if family == "binomial":
        if not set(np.unique(Y)) <= {0, 1}:
            raise ValueError(f"Survey logistic needs a 0/1 outcome (found {sorted(set(np.unique(Y)))})")
        m = sm.GLM(Y, X, family=sm.families.Binomial(), var_weights=w).fit()
        mu = np.asarray(m.predict(X), float)
        bread = (X * (w * mu * (1 - mu))[:, None]).T @ X
        link_note = "survey logistic (pseudo-MLE)"
    else:
        beta, *_ = np.linalg.lstsq(X * np.sqrt(w)[:, None], Y * np.sqrt(w), rcond=None)
        mu = X @ beta
        bread = (X * w[:, None]).T @ X
        link_note = "survey linear regression (WLS)"
    resid = Y - mu
    scores = (X * (w * resid)[:, None])          # n × p linearized scores
    dfu = pd.DataFrame(scores)
    dfu["h"], dfu["i"] = h, i
    psu_tot = dfu.groupby(["h", "i"], sort=True).sum()   # PSU totals per column
    meat = np.zeros((X.shape[1], X.shape[1]))
    for hh, grp in psu_tot.groupby(level=0):
        nh = len(grp)
        if nh < 2:
            continue
        c = nh / (nh - 1)
        M = grp.to_numpy(float)
        centered = M - M.mean(axis=0)
        meat += c * (centered.T @ centered)
    bread_inv = np.linalg.pinv(bread)
    V = bread_inv @ meat @ bread_inv
    se = np.sqrt(np.maximum(np.diag(V), 0))
    rows = []
    names = ["_cons"] + list(xs)
    for j, nm in enumerate(names):
        b = float(beta[j] if family == "gaussian" else np.asarray(m.params)[j])
        sj = float(se[j])
        tval = b / sj if sj else float("nan")
        pv = float(2 * (1 - stats.t.cdf(abs(tval), dfree))) if dfree >= 1 and not np.isnan(tval) else float("nan")
        tcrit = stats.t.ppf(0.975, dfree) if dfree >= 1 else float("nan")
        if family == "binomial":
            rows.append([nm, num(b), num(np.exp(b)), num(sj), num(tval), pval(pv),
                         f"[{num(np.exp(b - tcrit * sj))}, {num(np.exp(b + tcrit * sj))}]"])
        else:
            rows.append([nm, num(b), num(sj), num(tval), pval(pv),
                         f"[{num(b - tcrit * sj)}, {num(b + tcrit * sj)}]"])
    header = (["Variable", "Coef.", "exp(b)", "SE", "t", "p", "95% CI"] if family == "binomial"
              else ["Variable", "Coef.", "SE", "t", "p", "95% CI"])
    blocks = [
        table(f"{link_note.capitalize()} — {y} ~ {' + '.join(xs)}", header, rows,
              note="Design-based (Taylor-linearized) SEs; t tests on design df"),
        text(_design_note(len(d), n_strata, n_psu, dfree, singletons, w)),
    ]
    return result(f"Survey regression: {y} ~ {' + '.join(xs)}", blocks)
