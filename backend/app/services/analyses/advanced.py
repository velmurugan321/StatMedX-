"""Module 10 — Advanced analysis (first wave): linear mixed models, GEE,
repeated-measures ANOVA."""
from __future__ import annotations

import numpy as np
import pandas as pd
import statsmodels.api as sm
import statsmodels.formula.api as smf
from scipy import stats

from ..blocks import num, pval, result, table, text


def mixed_model(df: pd.DataFrame, y: str, fixed: list[str], random_group: str,
                random_slope: str | None = None) -> dict:
    cols = [y] + fixed + [random_group] + ([random_slope] if random_slope else [])
    d = df[cols].copy()
    for c in [y] + fixed + ([random_slope] if random_slope else []):
        d[c] = pd.to_numeric(d[c], errors="coerce")
    d = d.dropna()
    form = f"{y} ~ " + " + ".join(fixed)
    re_formula = "1" if not random_slope else f"1 + {random_slope}"
    m = smf.mixedlm(form, d, groups=d[random_group], re_formula=re_formula)
    res = m.fit(reml=True)
    # fixed effects table
    fe = res.fe_params
    fe_bse = res.bse_fe
    rows = []
    for nm in fe.index:
        b, se = fe[nm], fe_bse[nm]
        z = b / se if se else np.nan
        rows.append([str(nm), num(b), num(se), num(z), pval(2 * (1 - stats.norm.cdf(abs(z)))),
                     f"[{num(b - 1.96 * se)}, {num(b + 1.96 * se)}]"])
    var_rows = []
    try:
        var_rows.append([f"Group variance ({random_group})", num(res.cov_re.iloc[0, 0], 4)])
        if random_slope:
            var_rows.append([f"Slope variance ({random_slope})", num(res.cov_re.iloc[1, 1], 4)])
    except Exception:
        pass
    var_rows.append(["Residual variance", num(res.scale, 4)])
    icc = res.cov_re.iloc[0, 0] / (res.cov_re.iloc[0, 0] + res.scale) if res.cov_re.size else float("nan")
    blocks = [
        table(f"Linear mixed model (REML) — {y} ~ {' + '.join(fixed)}",
              ["Fixed effect", "Coef.", "Std. err.", "z", "p", "95% CI"], rows,
              note=f"Groups = {res.ngroups if hasattr(res,'ngroups') else d[random_group].nunique()} "
                   f"({random_group}); N = {int(res.nobs)}; LL = {res.llf:.2f}; AIC = {res.aic:.2f}"),
        table("Random effects", ["Component", "Variance"], var_rows,
              note=f"ICC = {num(icc, 3)}"),
    ]
    return result(f"Mixed model: {y} ~ {' + '.join(fixed)} + (1|{random_group})", blocks)


def gee(df: pd.DataFrame, y: str, predictors: list[str], group_var: str,
        family: str = "gaussian", corr: str = "exchangeable") -> dict:
    cols = [y] + predictors + [group_var]
    d = df[cols].copy()
    for c in [y] + predictors:
        d[c] = pd.to_numeric(d[c], errors="coerce")
    d = d.dropna()
    fam = {"gaussian": sm.families.Gaussian(),
           "binomial": sm.families.Binomial(),
           "poisson": sm.families.Poisson()}[family]
    cov = {"exchangeable": sm.cov_struct.Exchangeable(),
           "autoregressive": sm.cov_struct.Autoregressive(),
           "unstructured": sm.cov_struct.Unstructured(),
           "independence": sm.cov_struct.Independence()}[corr]
    form = f"{y} ~ " + " + ".join(predictors)
    m = smf.gee(form, group_var, d, family=fam, cov_struct=cov)
    res = m.fit()
    rows = []
    for nm in res.params.index:
        b, se = res.params[nm], res.bse[nm]
        z = b / se if se else np.nan
        rows.append([str(nm), num(b), num(se), num(z), pval(2 * (1 - stats.norm.cdf(abs(z)))),
                     f"[{num(b - 1.96 * se)}, {num(b + 1.96 * se)}]"])
    blocks = [
        table(f"GEE ({family}, {corr} correlation) — {y}",
              ["Term", "Coef.", "Robust SE", "z", "p", "95% CI"], rows,
              note=f"Clusters ({group_var}) = {d[group_var].nunique()}; N = {len(d)}"),
    ]
    return result(f"GEE: {y} ~ {' + '.join(predictors)}", blocks)


def repeated_measures(df: pd.DataFrame, measures: list[str], between: str | None = None) -> dict:
    """One-way repeated-measures ANOVA across 2+ measured columns (wide format)."""
    d = df[measures + ([between] if between else [])].apply(
        pd.to_numeric, errors="coerce").dropna()
    if len(measures) < 2:
        raise ValueError("Provide at least 2 repeated measures (wide-format columns).")
    n, k = len(d), len(measures)
    Y = d[measures].values
    grand = Y.mean()
    ss_subj = k * ((Y.mean(axis=1) - grand) ** 2).sum()
    ss_meas = n * ((Y.mean(axis=0) - grand) ** 2).sum()
    ss_tot = ((Y - grand) ** 2).sum()
    ss_err = ss_tot - ss_subj - ss_meas
    df_m, df_e = k - 1, (n - 1) * (k - 1)
    ms_m = ss_meas / df_m
    ms_e = ss_err / df_e
    f = ms_m / ms_e if ms_e else float("nan")
    p = float(1 - stats.f.cdf(f, df_m, df_e)) if not np.isnan(f) else float("nan")
    # Greenhouse-Geisser epsilon (approx via sphericity test)
    mauchly = None
    try:
        diffm = Y - Y.mean(axis=0)
        S = np.cov(diffm, rowvar=False, ddof=1)
        pdim = S.shape[0]
        mauchly_chi, eps = sphericity(S, n)
    except Exception:
        mauchly_chi, eps = float("nan"), 1.0
    desc = [[mv, num(d[mv].mean()), num(d[mv].std(ddof=1)), num(d[mv].median())] for mv in measures]
    blocks = [
        table("Repeated-measures descriptives", ["Measure", "Mean", "SD", "Median"], desc),
        table(f"Repeated-measures ANOVA (N = {n})",
              ["Source", "df", "SS", "MS", "F", "p"], [
                  ["Within subjects (measure)", df_m, num(ss_meas), num(ms_m), num(f), pval(p)],
                  ["Residual", df_e, num(ss_err), num(ms_e), "", ""],
                  ["Between subjects", n - 1, num(ss_subj), "", "", ""],
              ],
              note=f"GG ε ≈ {num(eps, 3)}; if ε < 0.75 use GG-corrected df "
                   f"(~{num(df_m * eps, 2)}, ~{num(df_e * eps, 2)})"),
    ]
    rows = []
    for i, mv in enumerate(measures):
        for j in range(i + 1, len(measures)):
            t, tp = stats.ttest_rel(d[mv], d[measures[j]])
            rows.append([f"{mv} vs {measures[j]}", num(d[mv].mean() - d[measures[j]].mean()),
                         num(t), pval(tp), pval(min(tp * (k * (k - 1) / 2), 1.0))])
    if rows:
        blocks.append(table("Pairwise paired t-tests (Bonferroni)",
                            ["Comparison", "Mean diff", "t", "p", "p (Bonferroni)"], rows))
    return result(f"Repeated measures ANOVA: {', '.join(measures)}", blocks)


def sphericity(S: np.ndarray, n: int) -> tuple[float, float]:
    """Mauchly's W → chi2 + Greenhouse-Geisser epsilon (lower bound approx)."""
    p = S.shape[0]
    W = np.linalg.det(S) / (np.trace(S) / p) ** p
    chi = -(n - 1 - (2 * p * p + p + 2) / (6 * p)) * np.log(max(W, 1e-300))
    # GG epsilon (approximation)
    S_off = S - np.diag(np.diag(S))
    denom = p - 1
    eps = max(1.0 / (p - 1), min(1.0, (np.trace(S) ** 2) / (p * (S ** 2).sum() + 1e-12) if (S ** 2).sum() else 1.0))
    pval_m = float(1 - stats.chi2.cdf(chi, p * (p - 1) / 2 - 1)) if p > 1 else 1.0
    return chi, eps
