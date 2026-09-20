"""Module 09 — Survival analysis: Kaplan-Meier, log-rank test, Cox proportional hazards."""
from __future__ import annotations

import numpy as np
import pandas as pd
import statsmodels.api as sm
from scipy import stats

from ..blocks import figure, num, pval, result, table, text


def _km_fit(time: np.ndarray, event: np.ndarray):
    """Kaplan-Meier estimate. Returns (times, survival, at_risk, events_at_time, censor_at_time)."""
    times = np.sort(np.unique(time[event == 1]))
    n_at_risk = []
    surv = []
    s = 1.0
    events_at = []
    cens_at = []
    for t in times:
        n_t = int((time >= t).sum())
        d_t = int(((time == t) & (event == 1)).sum())
        c_t = int(((time == t) & (event == 0)).sum())
        s *= (1 - d_t / n_t) if n_t else 1.0
        n_at_risk.append(n_t)
        surv.append(s)
        events_at.append(d_t)
        cens_at.append(c_t)
    return times, np.array(surv), np.array(n_at_risk), np.array(events_at), np.array(cens_at)


def kaplan_meier(df: pd.DataFrame, time_var: str, event_var: str, group_var: str | None = None) -> dict:
    d = df[[time_var, event_var] + ([group_var] if group_var else [])].copy()
    d[time_var] = pd.to_numeric(d[time_var], errors="coerce")
    d[event_var] = pd.to_numeric(d[event_var], errors="coerce")
    d = d.dropna()
    time = d[time_var].to_numpy(float)
    event = (d[event_var] > 0).to_numpy(int)
    data_traces = []
    blocks = []
    groups = ["All"] if not group_var else [str(g) for g in sorted(d[group_var].astype(str).unique(), key=str)]
    palette = ["#0ea5e9", "#f97316", "#8b5cf6", "#10b981", "#ef4444", "#eab308"]
    if group_var:
        gvals = d[group_var].astype(str)
        sub_sets = [(g, time[gvals == g], event[gvals == g]) for g in groups]
    else:
        sub_sets = [("All", time, event)]
    km_summary = []
    for i, (g, t, e) in enumerate(sub_sets):
        times, surv, nrisk, nevent, ncens = _km_fit(t, e)
        xs = [0.0] + times.tolist()
        ys = [1.0] + surv.tolist()
        data_traces.append({
            "type": "scatter", "mode": "lines", "x": xs, "y": ys,
            "line": {"shape": "hv", "color": palette[i % len(palette)], "width": 2.5},
            "name": g,
        })
        # censor marks
        ct = np.sort(t[(e == 0)])
        if len(ct):
            def surv_at(tt):
                s = 1.0
                for ut, ud, un in zip(times, nevent, nrisk):
                    if ut <= tt:
                        s *= (1 - ud / un)
                return s
            data_traces.append({
                "type": "scatter", "mode": "markers", "x": ct.tolist(),
                "y": [surv_at(v) for v in ct], "name": f"{g} censored",
                "marker": {"symbol": "line-ns-open", "size": 8, "color": palette[i % len(palette)]},
                "showlegend": False,
            })
        med = None
        for tt, ss in zip(xs, ys):
            if ss <= 0.5:
                med = tt
                break
        km_summary.append([g, int(len(t)), int(e.sum()), f"{e.mean() * 100:.1f}%",
                           num(med) if med is not None else "not reached"])
    fig = {"data": data_traces, "layout": {
        "paper_bgcolor": "white", "plot_bgcolor": "white",
        "font": {"family": "Inter, system-ui, sans-serif", "size": 12, "color": "#334155"},
        "margin": {"l": 60, "r": 30, "t": 50, "b": 60},
        "title": {"text": f"Kaplan-Meier survival: {time_var}" + (f" by {group_var}" if group_var else "")},
        "xaxis": {"title": {"text": f"{time_var}"}, "gridcolor": "#e2e8f0", "range": [0, float(time.max()) * 1.02]},
        "yaxis": {"title": {"text": "Survival probability"}, "gridcolor": "#e2e8f0", "range": [0, 1.02]},
        "legend": {"orientation": "h", "y": -0.25},
    }}
    blocks.append(figure("Kaplan-Meier curve", fig))
    blocks.append(table(f"KM summary ({time_var}, event = {event_var})",
                        ["Group", "N", "Events", "% event", "Median survival"], km_summary))
    if group_var and len(groups) >= 2:
        chi, p, dof = logrank_all(sub_sets)
        blocks.append(text(f"<b>Log-rank test</b>: χ²({dof}) = {chi:.3f}, p = {pval(p)}"))
    return result(f"Kaplan-Meier: {time_var}" + (f" by {group_var}" if group_var else ""), blocks)


def logrank_all(sub_sets) -> tuple[float, float, int]:
    """Multigroup log-rank (pooled O−E with covariance across groups)."""
    all_times = np.sort(np.unique(np.concatenate([t[e == 1] for _, t, e in sub_sets])))
    k = len(sub_sets)
    O = np.zeros(k)
    E = np.zeros(k)
    V = np.zeros((k, k))
    for t_j in all_times:
        n_j = np.array([ (t >= t_j).sum() for _, t, _ in sub_sets ], dtype=float)
        d_j = np.array([ ((t == t_j) & (e == 1)).sum() for _, t, e in sub_sets ], dtype=float)
        n = n_j.sum()
        d = d_j.sum()
        if n == 0 or d == 0:
            continue
        e_j = d * n_j / n
        E += e_j
        O += d_j
        for a in range(k):
            for b in range(k):
                if a == b:
                    V[a, a] += d_j[a] * (n_j[a] / n) * (1 - n_j[a] / n) * (n - d) / (n - 1) if n > 1 else 0
                else:
                    V[a, b] += -d * (n_j[a] / n) * (n_j[b] / n) * (n - d) / (n - 1) if n > 1 else 0
    if k == 2:
        chi = (O[0] - E[0]) ** 2 / V[0, 0] if V[0, 0] > 0 else 0.0
    else:
        O_red = O[:-1] - E[:-1]
        V_red = V[:-1, :-1]
        try:
            chi = float(O_red @ np.linalg.pinv(V_red) @ O_red)
        except Exception:
            chi = 0.0
    dof = k - 1
    p = float(1 - stats.chi2.cdf(chi, dof))
    return float(chi), p, dof


def cox(df: pd.DataFrame, time_var: str, event_var: str, covariates: list[str]) -> dict:
    d = df[[time_var, event_var] + covariates].copy()
    for c in [time_var, event_var] + covariates:
        d[c] = pd.to_numeric(d[c], errors="coerce")
    d = d.replace([np.inf, -np.inf], np.nan).dropna()
    m = sm.PHReg(d[time_var].values, sm.add_constant(d[covariates].values, has_constant="add"),
                 status=(d[event_var] > 0).astype(int).values, ties="efron")
    res = m.fit()
    params, bse = res.params, res.bse
    ci = res.conf_int()
    names = ["_cons"] + covariates
    rows = []
    for i, nm in enumerate(names):
        b, se = params[i], bse[i]
        hr = np.exp(b)
        lo, hi = np.exp(ci[i, 0]), np.exp(ci[i, 1])
        z = b / se if se else np.nan
        rows.append([nm, num(b), num(se), num(z), pval(2 * (1 - stats.norm.cdf(abs(z)))),
                     num(hr), f"[{num(lo)}, {num(hi)}]"])
    conc = res.concordance_c if hasattr(res, "concordance_c") else float("nan")
    # likelihood-ratio test vs null (constant-only) model
    try:
        m0 = sm.PHReg(d[time_var].values, np.ones((len(d), 1)),
                      status=(d[event_var] > 0).astype(int).values, ties="efron")
        llf_null = m0.fit().llf
        lr = 2 * (res.llf - llf_null)
        lr_p = float(1 - stats.chi2.cdf(lr, len(covariates)))
    except Exception:
        lr_p = float("nan")
    blocks = [
        table(f"Cox proportional hazards — {time_var}, event = {event_var}",
              ["Variable", "Coef.", "Std. err.", "z", "p", "Haz. ratio", "95% CI"], rows,
              note=f"N = {len(d)}, events = {int((d[event_var] > 0).sum())}; "
                   f"LR χ²({len(covariates)}) p = {pval(lr_p)}; "
                   f"Log-likelihood = {res.llf:.3f}; C-index = {num(conc, 3)}"),
        text("HR > 1 → higher hazard. Check proportional hazards (e.g. plot KM curves, "
             "inspect log(-log) survival) before interpreting."),
    ]
    return result(f"Cox regression: {time_var} ~ {' + '.join(covariates)}", blocks)
