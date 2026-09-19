"""Module 10 (propensity/survey) + Module 12 (do-file runner) validation."""
from __future__ import annotations

import numpy as np
import pandas as pd
import pytest
from scipy import stats

from app.models import Dataset
from app.services import analyses, command_parser
from app.services.analyses import propensity, survey
from app.routers.dofiles import _preprocess


def _table_rows(res, name_contains=""):
    return [b for b in res["blocks"]
            if b["type"] == "table" and name_contains.lower() in b.get("name", "").lower()]


def _texts(res):
    return [b["content"] for b in res["blocks"] if b["type"] == "text"]


# ---------------- propensity ----------------
@pytest.fixture(scope="module")
def ps_df():
    rng = np.random.default_rng(100)
    n = 800
    x = rng.normal(0, 1, n)
    x2 = rng.normal(0, 1, n)
    ps_true = 1 / (1 + np.exp(-(-0.5 + 1.0 * x)))
    t = (rng.random(n) < ps_true).astype(int)
    y = 2.0 + 1.5 * t + 1.2 * x + 0.4 * x2 + rng.normal(0, 2, n)
    return pd.DataFrame({"t": t, "y": y, "x": x, "x2": x2})


def test_propensity_matching_recovers_effect(ps_df):
    res = analyses.run("propensity", ps_df,
                       {"treatment": "t", "outcome": "y", "covariates": ["x", "x2"],
                        "method": "match", "caliper": 0.2})
    eff = _table_rows(res, "Treatment effect")[0]
    att = float(eff["rows"][0][0].replace(",", ""))
    assert abs(att - 1.5) < 0.35  # true effect 1.5
    bal = _table_rows(res, "balance")[0]
    smd_after = [abs(float(r[2])) for r in bal["rows"]]
    assert max(smd_after) < 0.15  # balance achieved


def test_propensity_iptw_recovers_ate(ps_df):
    res = analyses.run("propensity", ps_df,
                       {"treatment": "t", "outcome": "y", "covariates": ["x", "x2"],
                        "method": "iptw"})
    eff = _table_rows(res, "Treatment effect")[0]
    ate = float(eff["rows"][0][2].replace(",", ""))
    assert abs(ate - 1.5) < 0.35


def test_propensity_requires_binary_treatment(ps_df):
    with pytest.raises(ValueError):
        analyses.run("propensity", ps_df,
                     {"treatment": "y", "outcome": "x", "covariates": ["x2"], "method": "match"})


def test_propensity_treat_level(ps_df):
    d = ps_df.copy()
    d["grp"] = np.where(d["t"] == 1, "Drug", "Placebo")
    res = analyses.run("propensity", d,
                       {"treatment": "grp", "treat_level": "Drug", "outcome": "y",
                        "covariates": ["x"], "method": "match"})
    assert any("balance" in b.get("name", "").lower() for b in res["blocks"] if b["type"] == "table")


# ---------------- survey ----------------
def test_survey_mean_hand_computed():
    # 1 stratum, 2 PSUs: y=[1,2,3,4], w=[1,1,2,2], psu=[1,1,2,2]
    # theta = 17/6 = 2.8333; z totals per PSU = ∓2.6667
    # Var(Σz) = 2·(2.6667²+2.6667²) = 28.4444 → SE = √28.4444/6 = 0.8889
    d = pd.DataFrame({"y": [1, 2, 3, 4], "w": [1, 1, 2, 2], "psu": [1, 1, 2, 2]})
    res = analyses.run("survey_mean", d, {"var": "y", "weight": "w", "psu": "psu"})
    t = _table_rows(res, "Survey-weighted mean")[0]
    theta = float(t["rows"][0][0].replace(",", ""))
    se = float(t["rows"][0][1].replace(",", ""))
    assert abs(theta - 17 / 6) < 1e-3
    assert abs(se - 5.333333 / 6) < 1e-3


def test_survey_mean_with_strata():
    rng = np.random.default_rng(50)
    n = 300
    d = pd.DataFrame({
        "y": rng.normal(100, 15, n),
        "w": rng.uniform(0.5, 3, n).round(2),
        "strata": np.repeat(["A", "B"], n // 2),
        "psu": rng.integers(1, 31, n),
    })
    res = analyses.run("survey_mean", d, {"var": "y", "weight": "w", "strata": "strata", "psu": "psu"})
    t = _table_rows(res, "Survey-weighted mean")[0]
    est, se = float(t["rows"][0][0].replace(",", "")), float(t["rows"][0][1].replace(",", ""))
    # weighted mean sanity
    w = d["w"].to_numpy()
    wm = (w * d["y"]).sum() / w.sum()
    assert abs(est - wm) < 1e-3
    assert 0 < se < 10


def test_survey_prop_sums_to_100():
    rng = np.random.default_rng(8)
    d = pd.DataFrame({"g": rng.choice(["a", "b", "c"], 200),
                      "w": rng.uniform(1, 5, 200).round(2),
                      "psu": rng.integers(1, 21, 200)})
    res = analyses.run("survey_prop", d, {"var": "g", "weight": "w", "psu": "psu"})
    t = _table_rows(res, "proportions")[0]
    total = sum(float(r[3].replace("%", "")) for r in t["rows"])
    assert abs(total - 100) < 0.1


def test_survey_reg_matches_wls_coefficients():
    rng = np.random.default_rng(12)
    n = 400
    x = rng.normal(0, 1, n)
    w = rng.uniform(1, 4, n).round(2)
    y = 3 + 2 * x + rng.normal(0, 1, n)
    d = pd.DataFrame({"y": y, "x": x, "w": w, "psu": rng.integers(1, 41, n)})
    res = analyses.run("survey_reg", d, {"y": "y", "xs": ["x"], "weight": "w", "psu": "psu"})
    t = _table_rows(res, "Survey linear")[0]
    b_x = float(t["rows"][1][1].replace(",", ""))
    se_x = float(t["rows"][1][2].replace(",", ""))
    # WLS point estimate
    import statsmodels.api as sm
    X = sm.add_constant(d[["x"]])
    ref = sm.WLS(d["y"], X, weights=d["w"]).fit()
    assert abs(b_x - ref.params["x"]) < 1e-3  # matches WLS to displayed precision (3 dp)
    assert abs(b_x - ref.params["x"]) < 0.002
    assert 0 < se_x < 1


def test_survey_logistic_or():
    rng = np.random.default_rng(30)
    n = 2500
    x = rng.normal(0, 1, n)
    p = 1 / (1 + np.exp(-(0.3 + 0.9 * x)))
    d = pd.DataFrame({"y": (rng.random(n) < p).astype(int), "x": x,
                      "w": np.ones(n).round(2), "psu": rng.integers(1, 126, n)})
    res = analyses.run("survey_reg", d, {"y": "y", "xs": ["x"], "weight": "w", "psu": "psu",
                                         "family": "binomial"})
    t = _table_rows(res, "Survey logistic")[0]
    or_x = float(t["rows"][1][2].replace(",", ""))
    assert abs(or_x - np.exp(0.9)) < 0.35


# ---------------- do-file runner ----------------
def _ds():
    return Dataset(id=1, owner_id=1, name="t", n_rows=100, n_cols=3, meta={})


@pytest.fixture(scope="module")
def dofile_df():
    rng = np.random.default_rng(4)
    return pd.DataFrame({"age": rng.normal(55, 10, 100).round(0),
                         "chol": rng.normal(210, 30, 100).round(0),
                         "sex": rng.choice(["Male", "Female"], 100)})


def test_preprocess_comments_and_continuation():
    content = """* full comment line
describe
generate zz = age * 2  // trailing comment
summarize zz ///
   , detail
// another comment
"""
    steps = _preprocess(content)
    cmds = [c for _, c in steps]
    assert cmds == ["describe", "generate zz = age * 2", "summarize zz , detail"]


def test_dofile_run_sequential(dofile_df):
    ds = _ds()
    content = """* demo do-file
describe
generate zz = chol / 200
summarize zz, detail
keep if age > 40
sort age
"""
    steps = _preprocess(content)
    results = []
    mutated = False
    df_cur = dofile_df.copy()
    for _, line in steps:
        res, df_cur, mut, _ = command_parser.execute(ds, df_cur, line)
        results.append(res)
        mutated = mutated or mut
    assert len(results) == 5
    assert mutated
    assert "zz" in df_cur.columns
    assert df_cur["age"].is_monotonic_increasing


def test_dofile_stop_on_error(dofile_df):
    ds = _ds()
    content = "describe\nbadcommand_xyz\nsummarize age"
    steps = _preprocess(content)
    executed, stopped_at = 0, None
    for _, line in steps:
        try:
            command_parser.execute(ds, dofile_df.copy(), line)
            executed += 1
        except ValueError as e:
            stopped_at = line
            break
    assert executed == 1 and stopped_at == "badcommand_xyz"


def test_dofile_stset_persists_meta(dofile_df):
    ds = _ds()
    d2 = dofile_df.copy()
    d2["time"] = np.arange(1, 101, dtype=float)
    d2["event"] = 1
    res, df2, _, _ = command_parser.execute(ds, d2, "stset time, failure(event)")
    assert ds.meta.get("stset") == {"time": "time", "event": "event"}
    res2, *_ = command_parser.execute(ds, df2, "sts graph")
    assert "Kaplan-Meier" in res2["title"]


def test_propensity_and_survey_registered():
    assert callable(propensity.propensity) and callable(survey.survey_reg)


def test_console_svyset_and_svymean(dofile_df):
    ds = _ds()
    d2 = dofile_df.copy()
    d2["w"] = np.abs(rng_normal := np.random.default_rng(6).normal(1, 0.2, 100)).round(2)
    d2["psu"] = np.random.default_rng(7).integers(1, 21, 100)
    res, df2, _, _ = command_parser.execute(ds, d2, "svyset w, psu(psu)")
    assert ds.meta.get("svyset", {}).get("weight") == "w"
    res2, *_ = command_parser.execute(ds, df2, "svymean age")
    assert "Survey mean" in res2["title"]
    res3, *_ = command_parser.execute(ds, df2, "svyreg chol age")
    assert "Survey regression" in res3["title"]


def test_console_psmatch(dofile_df):
    ds = _ds()
    d2 = dofile_df.copy()
    d2["t"] = np.random.default_rng(9).integers(0, 2, 100)
    d2["y"] = np.random.default_rng(10).normal(50, 10, 100)
    res, *_ = command_parser.execute(ds, d2, "psmatch t y age chol")
    assert "Propensity score matching" in res["title"]
