"""Module 04 — Statistical tests (t-test, paired, Mann-Whitney, Wilcoxon, ANOVA,
Kruskal-Wallis, chi-square, Fisher exact) + normality diagnostics."""
from __future__ import annotations

import itertools

import numpy as np
import pandas as pd
from scipy import stats

from ..blocks import num, pval, result, table, text


def _numeric(df: pd.DataFrame, col: str) -> pd.Series:
    return pd.to_numeric(df[col], errors="coerce").dropna()


def _sw_note(s: pd.Series) -> str:
    if 3 <= len(s) <= 5000:
        w, p = stats.shapiro(s)
        return f"Shapiro-Wilk W = {w:.3f}, p = {pval(p)} ({'normal-ish' if p > .05 else 'non-normal'})"
    return "Shapiro-Wilk not computed (n out of 3–5000 range)"


def ttest_one(df: pd.DataFrame, var: str, testvalue: float = 0.0) -> dict:
    s = _numeric(df, var)
    t, p = stats.ttest_1samp(s, testvalue)
    mean, n = s.mean(), len(s)
    se = s.std(ddof=1) / np.sqrt(n)
    tcrit = stats.t.ppf(0.975, n - 1)
    lo, hi = mean - tcrit * se, mean + tcrit * se
    d = (mean - testvalue) / s.std(ddof=1) if s.std(ddof=1) else np.nan
    rows = [[var, n, num(mean), num(se), num(t), pval(p), f"[{num(lo)}, {num(hi)}]", num(d, 2)]]
    blocks = [
        table(f"One-sample t-test — H₀: mean({var}) = {num(testvalue)}",
              ["Variable", "N", "Mean", "SE", "t", "p", "95% CI", "Cohen's d"], rows),
        text(_sw_note(s)),
    ]
    return result(f"One-sample t-test: {var}", blocks)


def ttest_two(df: pd.DataFrame, var: str, group: str, welch: bool = True, equalvar: bool = False) -> dict:
    d = df[[var, group]].copy()
    d[var] = pd.to_numeric(d[var], errors="coerce")
    d = d.dropna()
    levels = sorted(d[group].astype(str).unique(), key=str)
    if len(levels) != 2:
        raise ValueError(f"Grouping variable '{group}' must have exactly 2 levels (found {len(levels)}). "
                         "Use ANOVA/Kruskal-Wallis for 3+ groups.")
    g1, g2 = (d.loc[d[group].astype(str) == lv, var] for lv in levels)
    lev = stats.levene(g1, g2)
    use_welch = welch or not equalvar
    t, p = stats.ttest_ind(g1, g2, equal_var=not use_welch)
    # Satterthwaite/Welch or pooled DF
    if use_welch:
        v1, v2 = g1.var(ddof=1) / len(g1), g2.var(ddof=1) / len(g2)
        dof = (v1 + v2) ** 2 / (v1 ** 2 / (len(g1) - 1) + v2 ** 2 / (len(g2) - 1))
        se = np.sqrt(v1 + v2)
    else:
        dof = len(g1) + len(g2) - 2
        pooled_sd = np.sqrt(((len(g1) - 1) * g1.var(ddof=1) + (len(g2) - 1) * g2.var(ddof=1)) /
                            (len(g1) + len(g2) - 2))
        se = pooled_sd * np.sqrt(1 / len(g1) + 1 / len(g2))
    diff = g1.mean() - g2.mean()
    pooled_sd = np.sqrt(((len(g1) - 1) * g1.var(ddof=1) + (len(g2) - 1) * g2.var(ddof=1)) /
                        (len(g1) + len(g2) - 2))
    dcoh = diff / pooled_sd if pooled_sd else np.nan
    tcrit = stats.t.ppf(0.975, dof)
    lo, hi = diff - tcrit * se, diff + tcrit * se
    u, pu = stats.mannwhitneyu(g1, g2, alternative="two-sided")
    rows = [
        [str(levels[0]), len(g1), num(g1.mean()), num(g1.std(ddof=1)), num(g1.mean(), None), ""],
        [str(levels[1]), len(g2), num(g2.mean()), num(g2.std(ddof=1)), num(g2.mean(), None), ""],
        ["combined", len(g1) + len(g2), num(d[var].mean()), num(d[var].std(ddof=1)), "", ""],
        ["diff", "", num(diff), num(se), f"t = {num(t)}", pval(p)],
    ]
    blocks = [
        table(f"Two-sample t-test: {var} by {group} ({'Welch' if use_welch else 'pooled'}, df={dof:.1f})",
              ["Group", "N", "Mean", "SD", "Mean", "p"], rows,
              note=f"Diff = {num(diff)}, 95% CI [{num(lo)}, {num(hi)}], Cohen's d = {num(dcoh, 2)}"),
        table("Normality & variance checks", ["Test", "Result"], [
            ["Levene equal-variance test", f"F-check p = {pval(lev[1])} ({'equal variances OK' if lev[1] > .05 else 'unequal — Welch recommended'})"],
            ["Shapiro–Wilk (group 1)", _sw_note(g1)],
            ["Shapiro–Wilk (group 2)", _sw_note(g2)],
            ["Mann-Whitney (non-parametric alternative)", f"U = {num(u)}, p = {pval(pu)}"],
        ]),
    ]
    return result(f"t-test: {var} by {group}", blocks)


def ttest_paired(df: pd.DataFrame, v1: str, v2: str) -> dict:
    d = df[[v1, v2]].apply(pd.to_numeric, errors="coerce").dropna()
    a, b = d[v1], d[v2]
    t, p = stats.ttest_rel(a, b)
    diff = a - b
    n = len(d)
    se = diff.std(ddof=1) / np.sqrt(n)
    tcrit = stats.t.ppf(0.975, n - 1)
    lo, hi = diff.mean() - tcrit * se, diff.mean() + tcrit * se
    w, pw = stats.wilcoxon(a, b) if n >= 10 else (np.nan, np.nan)
    rows = [[f"{v1} − {v2}", n, num(diff.mean()), num(se), num(t), pval(p), f"[{num(lo)}, {num(hi)}]"]]
    blocks = [
        table(f"Paired t-test: {v1} vs {v2}", ["Difference", "N", "Mean diff", "SE", "t", "p", "95% CI"], rows),
        text(f"Wilcoxon signed-rank (non-parametric alternative): p = {pval(pw)}<br>"
             + _sw_note(diff)),
    ]
    return result(f"Paired t-test: {v1} vs {v2}", blocks)


def mannwhitney(df: pd.DataFrame, var: str, group: str) -> dict:
    d = df[[var, group]].copy()
    d[var] = pd.to_numeric(d[var], errors="coerce")
    d = d.dropna()
    levels = sorted(d[group].astype(str).unique(), key=str)
    if len(levels) != 2:
        raise ValueError(f"'{group}' must have exactly 2 levels (found {len(levels)}).")
    g1, g2 = (d.loc[d[group].astype(str) == lv, var] for lv in levels)
    u, p = stats.mannwhitneyu(g1, g2, alternative="two-sided")
    method_note = "normal approximation (with continuity correction)"
    # R-parity: exact p-value from the midrank permutation distribution when feasible
    # (this matches R's tie-aware exact wilcox.test; ties make SciPy's integer-U
    # exact table and the normal approximation diverge)
    n_tot = len(g1) + len(g2)
    try:
        from itertools import combinations
        from math import comb
        from scipy.stats import rankdata
        if 0 < comb(n_tot, len(g1)) <= 500_000:
            ranks_all = rankdata(np.concatenate([g1, g2]))
            idx = np.array(list(combinations(range(n_tot), len(g1))))
            sums = ranks_all[idx].sum(axis=1)
            w_obs = ranks_all[: len(g1)].sum()
            p_low = (sums <= w_obs).mean()
            p_high = (sums >= w_obs).mean()
            p = min(1.0, 2 * min(p_low, p_high))
            method_note = "exact (midrank permutation, tie-aware)"
    except Exception:
        pass
    n1, n2 = len(g1), len(g2)
    mu = n1 * n2 / 2
    sigma = np.sqrt(n1 * n2 * (n1 + n2 + 1) / 12)
    z = (u - mu) / sigma if sigma else np.nan
    rb = 1 - 2 * u / (n1 * n2)  # rank-biserial
    ranks = stats.rankdata(pd.concat([g1, g2]))
    r1 = ranks[:n1].sum()
    rows = [
        [str(levels[0]), n1, num(g1.median()), num(g1.mean()), num(r1)],
        [str(levels[1]), n2, num(g2.median()), num(g2.mean()), num(ranks[n1:].sum())],
        ["test", "", "", f"U = {num(u)} (E[U]={num(mu)})", f"z = {num(z, 3)}"],
    ]
    blocks = [
        table(f"Mann-Whitney U test: {var} by {group}",
              ["Group", "N", "Median", "Mean", "Sum of ranks"], rows,
              note=f"p = {pval(p)} ({method_note}); rank-biserial r = {num(rb, 3)} (effect size)"),
        text("H₀: the two distributions are equal. Interpret with medians when data are skewed."),
    ]
    return result(f"Mann-Whitney U: {var} by {group}", blocks)


def wilcoxon(df: pd.DataFrame, v1: str, v2: str) -> dict:
    d = df[[v1, v2]].apply(pd.to_numeric, errors="coerce").dropna()
    a, b = d[v1], d[v2]
    w, p = stats.wilcoxon(a, b)
    diff = a - b
    nz = (diff != 0).sum()
    med = diff.median()
    rows = [[f"{v1} − {v2}", len(d), int(nz), num(med), num(w), pval(p)]]
    blocks = [
        table(f"Wilcoxon signed-rank test: {v1} vs {v2}",
              ["Pair", "N", "N non-zero diffs", "Median diff", "W", "p"], rows,
              note=f"Mean difference = {num(diff.mean())}"),
        text(_sw_note(diff) + " — if approximately normal, paired t-test is more powerful."),
    ]
    return result(f"Wilcoxon signed-rank: {v1} vs {v2}", blocks)


def anova(df: pd.DataFrame, var: str, group: str, posthoc: bool = True) -> dict:
    d = df[[var, group]].copy()
    d[var] = pd.to_numeric(d[var], errors="coerce")
    d = d.dropna()
    levels = sorted(d[group].astype(str).unique(), key=str)
    if len(levels) < 2:
        raise ValueError(f"'{group}' needs ≥2 levels.")
    groups = [d.loc[d[group].astype(str) == lv, var] for lv in levels]
    f, p = stats.f_oneway(*groups)
    grand = d[var].mean()
    k = len(groups)
    n = len(d)
    ssb = sum(len(g) * (g.mean() - grand) ** 2 for g in groups)
    ssw = sum(((g - g.mean()) ** 2).sum() for g in groups)
    rows = [["Between groups", k - 1, num(ssb), num(ssb / (k - 1)), num(f), pval(p)],
            ["Within groups", n - k, num(ssw), num(ssw / (n - k)), "", ""],
            ["Total", n - 1, num(ssb + ssw), "", "", ""]]
    blocks = [table(f"One-way ANOVA: {var} by {group}",
                    ["Source", "df", "SS", "MS", "F", "p"], rows,
                    note=f"η² = {num(ssb / (ssb + ssw), 3)} (effect size)")]
    desc = [[lv, len(g), num(g.mean()), num(g.std(ddof=1)), num(g.median())] for lv, g in zip(levels, groups)]
    blocks.append(table("Group descriptives", ["Group", "N", "Mean", "SD", "Median"], desc))
    blocks.append(text(_sw_note(d[var]) + " &nbsp;|&nbsp; Levene p = " +
                       pval(stats.levene(*groups)[1])))
    kw, kwp = stats.kruskal(*groups)
    blocks.append(text(f"Kruskal-Wallis (non-parametric alternative): H = {num(kw)}, p = {pval(kwp)}"))
    if posthoc and p < 0.05 and k > 2:
        ph = []
        for a, b in itertools.combinations(range(k), 2):
            t, tp = stats.ttest_ind(groups[a], groups[b])
            ph.append([f"{levels[a]} vs {levels[b]}", num(groups[a].mean() - groups[b].mean()),
                       num(t), pval(tp), pval(min(tp * len(list(itertools.combinations(range(k), 2))), 1.0))])
        blocks.append(table("Post-hoc pairwise t-tests (Bonferroni-adjusted p)",
                            ["Comparison", "Mean diff", "t", "p (raw)", "p (Bonferroni)"], ph))
    return result(f"One-way ANOVA: {var} by {group}", blocks)


def kruskal(df: pd.DataFrame, var: str, group: str) -> dict:
    d = df[[var, group]].copy()
    d[var] = pd.to_numeric(d[var], errors="coerce")
    d = d.dropna()
    levels = sorted(d[group].astype(str).unique(), key=str)
    groups = [d.loc[d[group].astype(str) == lv, var] for lv in levels]
    h, p = stats.kruskal(*groups)
    eps2 = (h - len(levels) + 1) / (len(d) - len(levels))
    rows = [[lv, len(g), num(g.median()), num(g.mean()), num(g.rank().mean())]
            for lv, g in zip(levels, groups)]
    blocks = [
        table(f"Kruskal-Wallis H test: {var} by {group}",
              ["Group", "N", "Median", "Mean", "Mean rank"], rows,
              note=f"H = {num(h)}, df = {len(levels)-1}, p = {pval(p)}; ε² = {num(eps2, 3)}"),
        text("Overall medians compared; use pairwise Wilcoxon/Mann-Whitney with adjustment for specific pairs."),
    ]
    return result(f"Kruskal-Wallis: {var} by {group}", blocks)
