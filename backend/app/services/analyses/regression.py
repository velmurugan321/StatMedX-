"""Module 06 — Regression (OLS, logistic, Poisson, robust Poisson, negative binomial,
multinomial logistic) + model diagnostics."""
from __future__ import annotations

import numpy as np
import pandas as pd
import statsmodels.api as sm
from scipy import stats

from ..blocks import num, pval, result, table, text


def _frame(df: pd.DataFrame, y: str, xs: list[str]) -> tuple[pd.Series, pd.DataFrame, list[str]]:
    cols = [y] + xs
    d = df[cols].apply(pd.to_numeric, errors="coerce").dropna()
    d = d.replace([np.inf, -np.inf], np.nan).dropna()
    Y = d[y].astype(float)
    X = sm.add_constant(d[xs].astype(float), has_constant="add")
    return Y, X, xs


def _coef_table(res, xs: list[str], y: str, transform=None, headers=None) -> list[list]:
    """transform(e, se) -> (effect_label_value, ci_lo, ci_hi) e.g. exp for IRR/OR."""
    params, bse = res.params, res.bse
    names = ["_cons"] + list(xs)
    rows = []
    ci = res.conf_int()
    for i, nm in enumerate(names):
        b = params.iloc[i] if hasattr(params, "iloc") else params[i]
        se = bse.iloc[i] if hasattr(bse, "iloc") else bse[i]
        lo, hi = ci.iloc[i, 0], ci.iloc[i, 1]
        if transform:
            b, lo, hi = transform(b), transform(lo), transform(hi)
        t = b / se if se else np.nan
        p = 2 * (1 - stats.norm.cdf(abs(t))) if transform else res.pvalues.iloc[i]
        rows.append([nm, num(b), num(se), num(t), pval(p), f"[{num(lo)}, {num(hi)}]"])
    return rows


OLS_HEADERS = ["Variable", "Coef.", "Std. err.", "t", "p", "95% CI"]
EXP_HEADERS = ["Variable", "exp(b)", "Std. err.", "z", "p", "95% CI"]


def linear(df: pd.DataFrame, y: str, xs: list[str], robust: bool = False) -> dict:
    Y, X, xs = _frame(df, y, xs)
    m = sm.OLS(Y, X)
    res = m.fit(cov_type="HC1") if robust else m.fit()
    rows = _coef_table(res, xs, y)
    blocks = [
        table(f"Linear regression (OLS) — {y}", OLS_HEADERS, rows,
              note=f"N = {int(res.nobs)};  R² = {res.rsquared:.4f};  Adj R² = {res.rsquared_adj:.4f};  "
                   f"F = {res.fvalue if res.fvalue is not None else '—'};  "
                   f"p = {pval(res.f_pvalue) if res.f_pvalue is not None else '—'};  "
                   f"RMSE = {np.sqrt(res.mse_resid):.4f}"),
    ]
    blocks += diagnostics_ols(df, y, xs, res)
    return result(f"Linear regression: {y} ~ {' + '.join(xs)}", blocks)


def diagnostics_ols(df: pd.DataFrame, y: str, xs: list[str], res) -> list[dict]:
    infl = res.get_influence()
    dw = sm.stats.stattools.durbin_watson(res.resid)
    try:
        bp = sm.stats.diagnostic.het_breuschpagan(res.resid, res.model.exog)
        bp_line = f"Breusch-Pagan p = {pval(bp[1])} ({'heteroskedasticity suspected' if bp[1] < .05 else 'constant variance OK'})"
    except Exception:
        bp_line = "Breusch-Pagan not computed"
    sw = stats.shapiro(res.resid) if 3 <= len(res.resid) <= 5000 else (np.nan, np.nan)
    # VIF
    X = res.model.exog
    vifs = []
    for i in range(1, X.shape[1]):
        others = np.delete(X, i, axis=1)
        r2i = sm.OLS(X[:, i], others).fit().rsquared
        vifs.append((res.model.exog_names[i], 1 / (1 - r2i) if r2i < 1 else np.inf))
    vrows = [[nm, num(v, 2)] for nm, v in vifs]
    lines = [
        f"Durbin-Watson = {dw:.3f}",
        bp_line,
        f"Shapiro-Wilk on residuals p = {pval(sw[1])}",
        f"Max Cook's D = {np.max(infl.cooks_distance[0]):.3f}",
    ]
    out = [table("Model diagnostics", ["Check", "Value"], [[a.split(" = ")[0], a.split(" = ", 1)[1]] for a in lines])]
    if vrows:
        out.append(table("Variance inflation factors", ["Variable", "VIF"], vrows,
                         note="VIF > 10 → multicollinearity concern"))
    return out


def logistic(df: pd.DataFrame, y: str, xs: list[str]) -> dict:
    Y, X, xs = _frame(df, y, xs)
    if set(Y.unique()) - {0, 1}:
        raise ValueError(f"Logistic outcome must be 0/1 (found {sorted(set(Y.unique()))}). "
                         "Recode first, e.g. generate outcome_bin = outcome == \"Yes\".")
    m = sm.Logit(Y, X).fit(disp=0)
    orows = _coef_table(m, xs, y, transform=np.exp)
    lrows = _coef_table(m, xs, y)
    pred = (m.predict(X) >= 0.5).astype(int)
    acc = float((pred == Y).mean())
    ct = pd.crosstab(Y, pred, rownames=["actual"], colnames=["predicted"])
    ct = ct.reindex(index=[0, 1], columns=[0, 1], fill_value=0)
    cls_rows = [[str(a), str(b), int(ct.loc[a, b])] for a in (0, 1) for b in (0, 1)]
    # Hosmer-Lemeshow
    hl_chi, hl_p = hosmer_lemeshow(Y, m.predict(X))
    blocks = [
        table(f"Logistic regression — odds ratios — {y}", EXP_HEADERS, orows,
              note=f"N = {int(m.nobs)};  Pseudo R² (McFadden) = {m.prsquared:.4f};  "
                   f"LR χ²({int(m.df_model)}) = {num(2 * (m.llf - m.llnull))}, p = "
                   f"{pval(m.llr_pvalue)};  AIC = {m.aic:.2f}, BIC = {m.bic:.2f}"),
        table("Coefficients (log-odds scale)", OLS_HEADERS, lrows),
        table("Classification table (cut-off 0.5)", ["actual \\ predicted", "0", "1"], cls_rows,
              note=f"Overall accuracy = {acc * 100:.1f}%"),
        text(f"Hosmer-Lemeshow goodness-of-fit: χ² = {num(hl_chi)}, df = 8, p = {pval(hl_p)} "
             f"({'adequate fit' if hl_p > .05 else 'poor fit'})"),
    ]
    return result(f"Logistic regression: {y} ~ {' + '.join(xs)}", blocks)


def hosmer_lemeshow(Y: pd.Series, phat: pd.Series, g: int = 10):
    d = pd.DataFrame({"y": Y.values, "p": phat.values})
    d["grp"] = pd.qcut(d["p"].rank(method="first"), min(g, len(d)), labels=False)
    obs = d.groupby("grp").agg(ysum=("y", "sum"), n=("y", "size"), pbar=("p", "mean"))
    chi = float((((obs.ysum - obs.n * obs.pbar) ** 2) / (obs.n * obs.pbar * (1 - obs.pbar))).sum())
    dof = len(obs) - 2
    p = float(1 - stats.chi2.cdf(chi, dof)) if dof > 0 else float("nan")
    return chi, p


def poisson(df: pd.DataFrame, y: str, xs: list[str], robust: bool = False) -> dict:
    Y, X, xs = _frame(df, y, xs)
    m = sm.GLM(Y, X, family=sm.families.Poisson())
    res = m.fit(cov_type="HC1") if robust else m.fit()
    irows = _coef_table(res, xs, y, transform=np.exp)
    rows = _coef_table(res, xs, y)
    header = EXP_HEADERS if robust else OLS_HEADERS
    name = "Robust Poisson (modified Poisson)" if robust else "Poisson regression"
    scale_note = (f"N = {int(res.nobs)};  Deviance = {res.deviance:.3f};  Pearson χ² = {res.pearson_chi2:.3f};  "
                  f"AIC = {res.aic:.2f};  robust (sandwich) SEs" if robust else
                  f"N = {int(res.nobs)};  Deviance = {res.deviance:.3f};  Pearson χ² = {res.pearson_chi2:.3f};  "
                  f"Deviance/df = {res.deviance / res.df_resid:.3f};  AIC = {res.aic:.2f}")
    blocks = [
        table(f"{name} — IRR (incidence-rate ratios) — {y}", EXP_HEADERS, irows,
              note=scale_note),
        table("Coefficients (log scale)", OLS_HEADERS, rows),
    ]
    if not robust:
        disp = res.pearson_chi2 / res.df_resid
        blocks.append(text(f"Dispersion (Pearson χ²/df) = {disp:.3f} — "
                           + ("overdispersion suspected; consider Negative Binomial." if disp > 1.5
                              else "no strong overdispersion.")))
    return result(f"{name}: {y} ~ {' + '.join(xs)}", blocks)


def negbin(df: pd.DataFrame, y: str, xs: list[str]) -> dict:
    Y, X, xs = _frame(df, y, xs)
    m = sm.NegativeBinomial(Y, X)
    res = m.fit(disp=0)
    irows = _coef_table(res, xs, y, transform=np.exp)
    rows = _coef_table(res, xs, y)
    blocks = [
        table(f"Negative binomial regression (NB2) — IRR — {y}", EXP_HEADERS, irows,
              note=f"N = {int(res.nobs)};  α (overdispersion) = {1 / res.params.iloc[-1] if False else 'see alpha below'};  "
                   f"AIC = {res.aic:.2f}, BIC = {res.bic:.2f}"),
        table("Coefficients (log scale)", OLS_HEADERS, rows),
        text(f"Likelihood-ratio test of α = 0 (vs Poisson): LRS = "
             f"{num(2 * (res.llf - sm.GLM(Y, X, family=sm.families.Poisson()).fit().llf))}"),
    ]
    return result(f"Negative binomial regression: {y} ~ {' + '.join(xs)}", blocks)


def multinomial(df: pd.DataFrame, y: str, xs: list[str]) -> dict:
    # y may be string/categorical — keep it, only numeric covariates
    cols = [y] + xs
    d = df[cols].copy()
    for c in xs:
        d[c] = pd.to_numeric(d[c], errors="coerce")
    d = d.replace([np.inf, -np.inf], np.nan).dropna()
    levels_raw = pd.Series(d[y]).astype(str)
    levels = sorted(levels_raw.unique())
    Y = levels_raw.map({v: i for i, v in enumerate(levels)}).astype(float)
    X = sm.add_constant(d[xs].astype(float), has_constant="add")
    if len(levels) < 3:
        raise ValueError("Multinomial logistic needs ≥3 outcome categories (use logistic for 2).")
    base = levels[0]
    m = sm.MNLogit(Y, X).fit(disp=0)
    params = m.params  # DataFrame: index=features, columns=outcome idx
    bse = m.bse
    blocks = [text(f"Multinomial logit — base outcome = <b>{base}</b> (reference); N = {int(m.nobs)}; "
                   f"Pseudo R² = {m.prsquared:.4f}; LR χ² p = {pval(m.llr_pvalue)}")]
    for j, lv in enumerate(levels[1:], start=0):
        rows = []
        for i, nm in enumerate(["_cons"] + xs):
            b = params.iloc[i, j]
            se = bse.iloc[i, j]
            lo, hi = b - 1.96 * se, b + 1.96 * se
            z = b / se if se else np.nan
            rows.append([nm, num(np.exp(b)), num(b), num(z), pval(2 * (1 - stats.norm.cdf(abs(z)))),
                         f"[{num(np.exp(lo))}, {num(np.exp(hi))}]"])
        blocks.append(table(f"Relative-risk ratios: {lv} vs {base}", EXP_HEADERS, rows))
    return result(f"Multinomial logistic: {y} ~ {' + '.join(xs)}", blocks)
