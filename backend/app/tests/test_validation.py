"""Module 15 — Validation suite.

Numerical accuracy checks against hand-computed reference values and scipy/statsmodels
cross-checks. Run with:  cd backend && .venv/bin/pytest app/tests -v
"""
from __future__ import annotations

import numpy as np
import pandas as pd
import pytest
from scipy import stats

from app.services import analyses
from app.services.analyses import diagnostic, roc, survival


def _table_rows(res, name_contains=""):
    out = []
    for b in res["blocks"]:
        if b["type"] == "table" and name_contains.lower() in b.get("name", "").lower():
            out.append(b)
    return out


@pytest.fixture(scope="module")
def df():
    rng = np.random.default_rng(7)
    n = 200
    g = rng.choice(["A", "B"], n)
    y = rng.normal(100 + 5 * (g == "B"), 12, n)
    return pd.DataFrame({
        "x": y,
        "g": g,
        "age": rng.integers(20, 80, n),
        "outcome": (rng.random(n) < 0.3).astype(int),
        "score": rng.normal(0, 1, n),
        "time": rng.exponential(40, n).round(2),
        "event": (rng.random(n) < 0.5).astype(int),
    })


# ---------- descriptives ----------
def test_mean_sd_known(df):
    s = df["x"]
    res = analyses.run("descriptive_summarize", df, {"variables": ["x"]})
    t = _table_rows(res, "Summary")[0]
    row = t["rows"][0]
    assert float(str(row[1])) == len(s)
    assert abs(float(str(row[4]).replace(",", "")) - s.mean()) < 1e-3
    assert abs(float(str(row[5]).replace(",", "")) - s.std(ddof=1)) < 1e-3


def test_median_iqr(df):
    s = df["x"]
    res = analyses.run("descriptive_summarize", df, {"variables": ["x"], "detail": True})
    t = _table_rows(res, "Summary")[0]
    row = t["rows"][0]
    assert abs(float(str(row[7]).replace(",", "")) - s.median()) < 1e-3
    assert abs(float(str(row[9]).replace(",", "")) - s.quantile(0.75)) < 1e-3


# ---------- t-tests ----------
def test_ttest_matches_scipy(df):
    res = analyses.run("ttest_two", df, {"variable": "x", "group": "g"})  # default = Welch
    a = df.loc[df.g == "A", "x"]
    b = df.loc[df.g == "B", "x"]
    t_ref, p_ref = stats.ttest_ind(a, b, equal_var=False)
    t = _table_rows(res, "t-test")[0]
    diff_row = t["rows"][-1]
    t_val = float(str(diff_row[4]).replace("t = ", "").replace(",", ""))
    assert abs(t_val - t_ref) < 5e-3  # displayed rounded to 3 dp


def test_ttest_pooled_matches_scipy(df):
    res = analyses.run("ttest_two", df, {"variable": "x", "group": "g", "welch": False, "equalvar": True})
    a = df.loc[df.g == "A", "x"]
    b = df.loc[df.g == "B", "x"]
    t_ref, _ = stats.ttest_ind(a, b, equal_var=True)
    t = _table_rows(res, "t-test")[0]
    t_val = float(str(t["rows"][-1][4]).replace("t = ", "").replace(",", ""))
    assert abs(t_val - t_ref) < 5e-3


def test_ttest_paired(df):
    rng = np.random.default_rng(3)
    d = pd.DataFrame({"pre": rng.normal(50, 10, 60), "post": 0})
    d["post"] = d["pre"] + rng.normal(2, 5, 60)
    res = analyses.run("ttest_paired", d, {"v1": "pre", "v2": "post"})
    t_ref, p_ref = stats.ttest_rel(d["pre"], d["post"])
    t = _table_rows(res, "Paired")[0]
    assert abs(float(str(t["rows"][0][4]).replace(",", "")) - t_ref) < 5e-3


# ---------- chi-square ----------
def test_chi_square(df):
    d = df.copy()
    d["hi"] = (d["age"] > 50).astype(int)
    ct = pd.crosstab(d["g"], d["hi"])
    chi_ref, p_ref, dof_ref, _ = stats.chi2_contingency(ct)
    res = analyses.run("chi2", d, {"row": "g", "col": "hi"})
    txt = [b for b in res["blocks"] if b["type"] == "text"][0]["content"]
    chi_val = float(txt.split("χ²(")[1].split(")")[1].split("=")[1].split(",")[0])
    assert abs(chi_val - chi_ref) < 5e-3


# ---------- regression ----------
def test_ols_coefficients(df):
    rng = np.random.default_rng(11)
    d = pd.DataFrame({"x1": rng.normal(0, 1, 300)})
    d["y"] = 2.0 + 1.5 * d["x1"] + rng.normal(0, 1, 300)
    res = analyses.run("reg_linear", d, {"y": "y", "xs": ["x1"]})
    t = _table_rows(res, "Linear")[0]
    x1_row = t["rows"][1]  # after _cons
    assert abs(float(x1_row[1].replace(",", "")) - 1.5) < 0.25  # finite-sample tolerance
    assert abs(float(t["rows"][0][1].replace(",", "")) - 2.0) < 0.25


def test_logistic_or(df):
    rng = np.random.default_rng(5)
    n = 600
    x = rng.normal(0, 1, n)
    p = 1 / (1 + np.exp(-(0.5 + 0.8 * x)))
    y = (rng.random(n) < p).astype(int)
    d = pd.DataFrame({"x": x, "y": y})
    res = analyses.run("reg_logistic", d, {"y": "y", "xs": ["x"]})
    t = _table_rows(res, "odds ratios")[0]
    or_val = float(t["rows"][1][1].replace(",", ""))
    assert abs(or_val - np.exp(0.8)) < 0.25  # MLE tolerance with finite n


# ---------- diagnostic 2×2 ----------
def test_diagnostic_measures():
    res = diagnostic.twobytwo(tp=45, fp=10, fn=5, tn=140)
    t = _table_rows(res, "accuracy")[0]
    measures = {r[0]: r[1] for r in t["rows"]}
    assert abs(float(measures["Sensitivity"]) - 45 / 50) < 1e-3      # shown to 4 dp
    assert abs(float(measures["Specificity"]) - 140 / 150) < 1e-3
    assert abs(float(measures["PPV"]) - 45 / 55) < 1e-3
    assert abs(float(measures["NPV"]) - 140 / 145) < 1e-3
    assert abs(float(measures["Accuracy"]) - 185 / 200) < 1e-3


# ---------- ROC ----------
def test_roc_auc_perfect_and_random():
    y = np.array([0, 0, 0, 0, 1, 1, 1, 1])
    perfect = np.array([1, 2, 3, 4, 5, 6, 7, 8])  # perfectly separated
    auc, _ = roc.auc_se_hanley(y, perfect)
    assert abs(auc - 1.0) < 1e-6
    rng = np.random.default_rng(2)
    auc_r, _ = roc.auc_se_hanley(rng.integers(0, 2, 500), rng.normal(size=500))
    assert 0.4 < auc_r < 0.6


# ---------- survival ----------
def test_km_known_small():
    time = np.array([1, 2, 2, 3, 4, 5], float)
    event = np.array([1, 0, 1, 1, 0, 1])
    times, surv, _, _, _ = survival._km_fit(time, event)
    # n at risk at t = count(time >= t); deaths at t = count((time==t)&(event==1))
    # t=1: 6 at risk, 1 death → S = 5/6
    # t=2: 5 at risk, 1 death → S = 5/6 · 4/5
    # t=3: 3 at risk, 1 death → S = 5/6 · 4/5 · 2/3
    s1 = 1 - 1 / 6
    s2 = s1 * (1 - 1 / 5)
    s3 = s2 * (1 - 1 / 3)
    assert np.isclose(surv[0], s1)
    assert np.isclose(surv[1], s2)
    assert np.isclose(surv[2], s3)


def test_logrank_two_groups():
    rng = np.random.default_rng(9)
    t1 = rng.exponential(20, 60)
    t2 = rng.exponential(40, 60)
    e1 = np.ones(60, int)
    chi, p, dof = survival.logrank_all([("A", t1, e1), ("B", t2, e1)])
    assert dof == 1
    assert chi > 3  # strong difference should be detected
    assert p < 0.1


# ---------- numerical tolerance / reproducibility ----------
def test_reproducibility(df):
    r1 = analyses.run("descriptive_summarize", df, {"variables": ["x"]})
    r2 = analyses.run("descriptive_summarize", df, {"variables": ["x"]})
    assert r1 == r2


def test_anova_matches_scipy(df):
    rng = np.random.default_rng(21)
    d = pd.DataFrame({"y": rng.normal(0, 1, 90),
                      "g": np.repeat(["a", "b", "c"], 30)})
    f_ref, p_ref = stats.f_oneway(*[d.loc[d.g == lv, "y"] for lv in "abc"])
    res = analyses.run("anova", d, {"variable": "y", "group": "g"})
    t = _table_rows(res, "ANOVA")[0]
    f_val = float(str(t["rows"][0][4]).replace(",", ""))
    assert abs(f_val - f_ref) < 5e-3
