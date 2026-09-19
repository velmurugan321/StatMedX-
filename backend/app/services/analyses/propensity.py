"""Module 10 — Propensity score analysis.

Methods:
  • Greedy nearest-neighbour 1:1 matching without replacement, caliper
    = `caliper` × SD(logit PS) (default 0.2 — Austin's recommendation).
    Effect estimated = ATT (mean of paired differences).
  • IPTW (stabilized inverse-probability-of-treatment weights), trimmed at
    PS ∈ [0.01, 0.99]. Effect estimated = ATE (Hájek estimator) with
    bootstrap SE. Binary outcomes additionally get a weighted odds ratio.

Diagnostics: PS model table, covariate balance (standardized mean differences
before/after), overlap histogram, love plot, common support, ESS.
"""
from __future__ import annotations

import numpy as np
import pandas as pd
import statsmodels.api as sm
from scipy import stats

from ..blocks import figure, num, pval, result, table, text


def _smd(x_t: pd.Series, x_c: pd.Series) -> float:
    denom = np.sqrt((x_t.var(ddof=1) + x_c.var(ddof=1)) / 2)
    if not denom or np.isnan(denom):
        return 0.0
    return float((x_t.mean() - x_c.mean()) / denom)


def _wmean_var(x: np.ndarray, w: np.ndarray) -> tuple[float, float]:
    m = float((w * x).sum() / w.sum())
    v = float((w * (x - m) ** 2).sum() / w.sum())
    return m, v


def _wsmd(x: np.ndarray, w: np.ndarray, t: np.ndarray) -> float:
    mt, vt = _wmean_var(x[t == 1], w[t == 1])
    mc, vc = _wmean_var(x[t == 0], w[t == 0])
    denom = np.sqrt((vt + vc) / 2)
    return float((mt - mc) / denom) if denom else 0.0


def _overlap_fig(ps: np.ndarray, t: np.ndarray):
    return {"data": [
        {"type": "histogram", "x": ps[t == 1].tolist(), "name": "treated",
         "opacity": 0.55, "marker": {"color": "#0ea5e9"}, "nbinsx": 30},
        {"type": "histogram", "x": ps[t == 0].tolist(), "name": "control",
         "opacity": 0.55, "marker": {"color": "#f97316"}, "nbinsx": 30},
    ], "layout": {
        "barmode": "overlay",
        "paper_bgcolor": "white", "plot_bgcolor": "white",
        "font": {"family": "Inter, system-ui, sans-serif", "size": 12, "color": "#334155"},
        "margin": {"l": 60, "r": 30, "t": 50, "b": 60},
        "title": {"text": "Propensity score overlap"},
        "xaxis": {"title": {"text": "Propensity score"}, "gridcolor": "#e2e8f0"},
        "yaxis": {"title": {"text": "Count"}, "gridcolor": "#e2e8f0"},
        "legend": {"orientation": "h", "y": -0.25},
    }}


def _love_fig(covariates: list[str], before: list[float], after: list[float], label: str):
    idx = list(range(len(covariates)))
    return {"data": [
        {"type": "scatter", "mode": "markers", "x": before, "y": covariates,
         "name": "before", "marker": {"color": "#94a3b8", "size": 8}},
        {"type": "scatter", "mode": "markers", "x": after, "y": covariates,
         "name": f"after {label}", "marker": {"color": "#0ea5e9", "size": 9}},
    ], "layout": {
        "paper_bgcolor": "white", "plot_bgcolor": "white",
        "font": {"family": "Inter, system-ui, sans-serif", "size": 12, "color": "#334155"},
        "margin": {"l": 110, "r": 30, "t": 50, "b": 60},
        "title": {"text": "Covariate balance (standardized mean differences)"},
        "xaxis": {"title": {"text": "SMD"}, "gridcolor": "#e2e8f0", "zeroline": True},
        "legend": {"orientation": "h", "y": -0.25},
    }}


def propensity(df: pd.DataFrame, treatment: str, covariates: list[str], outcome: str | None = None,
               method: str = "match", caliper: float = 0.2, treat_level: str | None = None,
               n_boot: int = 200) -> dict:
    cols = [treatment] + covariates + ([outcome] if outcome else [])
    d = df[cols].copy()
    for c in covariates + ([outcome] if outcome else []):
        d[c] = pd.to_numeric(d[c], errors="coerce")
    if not treat_level:
        d[treatment] = pd.to_numeric(d[treatment], errors="coerce")
    d = d.replace([np.inf, -np.inf], np.nan).dropna(subset=covariates + ([outcome] if outcome else []) +
                                                   ([] if treat_level else [treatment]))
    if treat_level:
        T = (d[treatment].astype(str) == str(treat_level)).astype(int).to_numpy()
    else:
        T = d[treatment].astype(int).to_numpy()
    if not set(np.unique(T)) <= {0, 1}:
        raise ValueError(f"Treatment must be 0/1 (found {sorted(set(np.unique(T)))}). "
                         "Use the 'positive level' option for string treatments, or recode first.")
    if T.sum() < 5 or (1 - T).sum() < 5:
        raise ValueError("Need ≥5 treated and ≥5 controls.")
    X = sm.add_constant(d[covariates].astype(float), has_constant="add")
    ps_model = sm.Logit(T, X).fit(disp=0)
    ps = np.asarray(ps_model.predict(X), dtype=float)
    logit_ps = np.log(ps / (1 - ps))
    cal = caliper * float(np.std(logit_ps))

    # ---- PS model table ----
    ps_rows = []
    names = ["_cons"] + list(covariates)
    for i, nm in enumerate(names):
        b = ps_model.params.iloc[i] if hasattr(ps_model.params, "iloc") else ps_model.params[i]
        se = ps_model.bse.iloc[i] if hasattr(ps_model.bse, "iloc") else ps_model.bse[i]
        orv = np.exp(b)
        z = b / se if se else np.nan
        ps_rows.append([nm, num(b), num(orv), num(z), pval(2 * (1 - stats.norm.cdf(abs(z))))])

    blocks = [
        table(f"Propensity score model — logistic: {treatment} ~ {' + '.join(covariates)}",
              ["Variable", "Coef.", "OR", "z", "p"], ps_rows,
              note=f"N = {len(d)} ({int(T.sum())} treated / {int((1 - T).sum())} controls); "
                   f"PS range [{ps.min():.3f}, {ps.max():.3f}]"),
    ]

    # ---- balance before ----
    smd_before = [_smd(d.loc[T == 1, c], d.loc[T == 0, c]) for c in covariates]

    effect_title = None
    effect_lines = []

    if method == "match":
        # greedy 1:1 nearest neighbour without replacement
        treated_idx = np.where(T == 1)[0]
        control_idx = np.where(T == 0)[0]
        order = treated_idx[np.argsort(-logit_ps[treated_idx])]
        used = np.zeros(len(control_idx), dtype=bool)
        pairs = []
        n_outside = 0
        cs = control_idx
        for ti in order:
            dist = np.abs(logit_ps[cs] - logit_ps[ti])  # match on the logit scale
            dist[used] = np.inf
            j = int(np.argmin(dist))
            if dist[j] <= cal:
                pairs.append((ti, cs[j]))
                used[j] = True
            else:
                n_outside += 1
        t_m = np.array([p[0] for p in pairs])
        c_m = np.array([p[1] for p in pairs])
        blocks.append(text(
            f"<b>Matching</b>: 1:1 nearest neighbour without replacement, caliper = "
            f"{caliper}×SD(logit PS) = {cal:.3f}. Matched {len(pairs)} pairs "
            f"({int(T.sum()) - len(pairs)} treated unmatched, {n_outside} outside caliper; "
            f"{int((1 - T).sum()) - used.sum()} controls unused)."))
        # balance after matching
        smd_after = [_smd(d.iloc[t_m][c], d.iloc[c_m][c]) for c in covariates]
        if outcome:
            diffs = d[outcome].to_numpy(float)[t_m] - d[outcome].to_numpy(float)[c_m]
            k = len(diffs)
            att = float(diffs.mean())
            se = float(diffs.std(ddof=1) / np.sqrt(k)) if k > 1 else float("nan")
            tcrit = stats.t.ppf(0.975, k - 1) if k > 1 else float("nan")
            tval = att / se if se else np.nan
            pv = float(2 * (1 - stats.t.cdf(abs(tval), k - 1))) if k > 1 else float("nan")
            blocks.append(table(f"Treatment effect (ATT) on {outcome} — {k} matched pairs",
                                ["Estimate", "SE", "t", "p", "95% CI"],
                                [[num(att), num(se), num(tval), pval(pv),
                                  f"[{num(att - tcrit * se)}, {num(att + tcrit * se)}]"]],
                                note="Paired-difference estimator on the matched sample"))
        else:
            smd_after = smd_after
        figlabel = "matching"

    else:  # iptw
        # stabilized weights, trimmed to common support [0.01, 0.99]
        trim = (ps < 0.01) | (ps > 0.99)
        n_trim = int(trim.sum())
        keep = ~trim
        p_t = float(T.mean())
        w = np.where(T == 1, p_t / ps, (1 - p_t) / (1 - ps))
        w[trim] = np.nan
        wk = w[keep]
        Tk, yk = T[keep], d[outcome].to_numpy(float)[keep] if outcome else None
        psk = ps[keep]
        ess_t = float(wk[Tk == 1].sum() ** 2 / (wk[Tk == 1] ** 2).sum())
        ess_c = float(wk[Tk == 0].sum() ** 2 / (wk[Tk == 0] ** 2).sum())
        blocks.append(text(
            f"<b>IPTW</b>: stabilized weights; trimmed {n_trim} obs outside PS [0.01, 0.99]. "
            f"Effective sample size — treated ESS = {ess_t:.1f} (of {int(Tk.sum())}), "
            f"control ESS = {ess_c:.1f} (of {int((1 - Tk).sum())})."))
        # balance after weighting
        smd_after = []
        Xk = d.loc[keep, covariates].to_numpy(float)
        for j, c in enumerate(covariates):
            smd_after.append(_wsmd(Xk[:, j], wk, Tk))
        if outcome is not None:
            mu1 = float((wk[Tk == 1] * yk[Tk == 1]).sum() / wk[Tk == 1].sum())
            mu0 = float((wk[Tk == 0] * yk[Tk == 0]).sum() / wk[Tk == 0].sum())
            ate = mu1 - mu0
            rng = np.random.default_rng(42)
            n_k = len(yk)
            boots = []
            idx = np.arange(n_k)
            for _ in range(n_boot):
                smp = rng.choice(idx, size=n_k, replace=True)
                Ts_, ys_, ws_ = Tk[smp], yk[smp], wk[smp]
                if len(np.unique(Ts_)) < 2:
                    continue
                b1 = (ws_[Ts_ == 1] * ys_[Ts_ == 1]).sum() / ws_[Ts_ == 1].sum()
                b0 = (ws_[Ts_ == 0] * ys_[Ts_ == 0]).sum() / ws_[Ts_ == 0].sum()
                boots.append(b1 - b0)
            se = float(np.std(boots, ddof=1)) if len(boots) > 2 else float("nan")
            z = ate / se if se else np.nan
            pv = 2 * (1 - stats.norm.cdf(abs(z))) if not np.isnan(z) else float("nan")
            extra_note = ""
            if set(np.unique(yk)) <= {0.0, 1.0}:
                Xb = sm.add_constant(pd.DataFrame({"treat": Tk}), has_constant="add")
                try:
                    gm = sm.GLM(yk, Xb, family=sm.families.Binomial(), var_weights=wk).fit()
                    orb = float(np.exp(gm.params.iloc[1]))
                    lorb_se = float(gm.bse.iloc[1])
                    extra_note = (f"; weighted OR = {orb:.3f} "
                                  f"(95% CI [{np.exp(gm.params.iloc[1] - 1.96 * lorb_se):.3f}, "
                                  f"{np.exp(gm.params.iloc[1] + 1.96 * lorb_se):.3f}])")
                except Exception:
                    pass
            blocks.append(table(f"Treatment effect (ATE) on {outcome} — IPTW (Hájek)",
                                ["μ treated", "μ control", "ATE", "bootstrap SE", "z", "p", "95% CI"],
                                [[num(mu1), num(mu0), num(ate), num(se), num(z), pval(pv),
                                  f"[{num(ate - 1.96 * se)}, {num(ate + 1.96 * se)}]"]],
                                note=f"Hájek estimator, {len(boots)} bootstrap replicates{extra_note}"))
        figlabel = "weighting"

    # ---- balance table + figures ----
    max_after = max(abs(s) for s in smd_after) if smd_after else 0.0
    bal_rows = []
    for c, b4, af in zip(covariates, smd_before, smd_after):
        red = (1 - abs(af) / abs(b4)) * 100 if abs(b4) > 1e-12 else float("nan")
        bal_rows.append([c, num(b4, 3), num(af, 3), num(red, 0) + "%",
                         "⚠ imbalanced" if abs(af) > 0.1 else "ok"])
    blocks.append(table("Covariate balance (standardized mean differences)",
                        ["Covariate", "SMD before", f"SMD after {figlabel}", "% reduction", "Status"],
                        bal_rows,
                        note=f"|SMD| < 0.10 indicates adequate balance; max after = {max_after:.3f}"))
    blocks.append(figure("Overlap", _overlap_fig(ps, T)))
    blocks.append(figure("Love plot", _love_fig(covariates, smd_before, smd_after, figlabel)))
    title = (f"Propensity score {'matching' if method == 'match' else 'IPTW'} — {treatment}"
             + (f" → {outcome}" if outcome else " (balance only)"))
    return result(title, blocks)
