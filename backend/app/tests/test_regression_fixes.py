"""Regression tests for bug fixes: barchart by-mode crash, PLR CI variance,
duplicate 'Mean' column in ttest_two."""
from __future__ import annotations

import math
import re

import numpy as np
import pandas as pd

from app.services.analyses import diagnostic, graphics, tests_stats


def _tbl(res, name_contains):
    for b in res["blocks"]:
        if b["type"] == "table" and name_contains.lower() in b.get("name", "").lower():
            return b
    raise AssertionError(f"table '{name_contains}' not found")


def test_barchart_by_mean_sum_count():
    df = pd.DataFrame({
        "chol": [200.0] * 4 + [220.0] * 4 + [100.0] * 2,
        "group": ["A"] * 4 + ["B"] * 4 + ["A"] * 2,
    })
    # previously: AttributeError "'str' object has no attribute 'astype'"
    r_mean = graphics.barchart(df, "chol", by="group", stat="mean")
    r_sum = graphics.barchart(df, "chol", by="group", stat="sum")
    r_count = graphics.barchart(df, "chol", by="group", stat="count")
    for r in (r_mean, r_sum, r_count):
        assert r["blocks"] and r["blocks"][0]["type"] == "figure"
    means = r_mean["blocks"][0]["spec"]["data"][0]
    d = dict(zip(means["x"], means["y"]))
    assert abs(float(d["A"]) - (200 * 4 + 100 * 2) / 6) < 1e-9   # A: four 200s, two 100s
    assert abs(float(d["B"]) - 220.0) < 1e-9
    sums = r_sum["blocks"][0]["spec"]["data"][0]
    ds = dict(zip(sums["x"], sums["y"]))
    assert abs(float(ds["A"]) - (200 * 4 + 100 * 2)) < 1e-9
    assert abs(float(ds["B"]) - 880.0) < 1e-9
    counts = r_count["blocks"][0]["spec"]["data"][0]
    dc = dict(zip(counts["x"], counts["y"]))
    assert dc == {"A": 6, "B": 4}


def test_plr_ci_uses_correct_variance():
    tp, fp, fn, tn = 45, 10, 5, 140
    res = diagnostic.twobytwo(tp=tp, fp=fp, fn=fn, tn=tn)
    t = _tbl(res, "accuracy")
    plr_row = next(r for r in t["rows"] if "PLR" in str(r[0]))
    sens, spec = tp / (tp + fn), tn / (tn + fp)
    n1, n0 = tp + fn, tn + fp
    plr = sens / (1 - spec)
    # correct formula: Var(ln PLR) = (1-Sens)/(n1·Sens) + Spec/(n0·(1-Spec))
    var = (1 - sens) / (sens * n1) + spec / ((1 - spec) * n0)
    se = math.sqrt(var)
    lo, hi = plr * math.exp(-1.96 * se), plr * math.exp(1.96 * se)
    m = re.findall(r"[\d.]+", plr_row[2])
    got_lo, got_hi = float(m[0]), float(m[1])
    assert abs(got_lo - lo) < 0.002, (got_lo, lo)
    assert abs(got_hi - hi) < 0.002, (got_hi, hi)
    assert got_lo < plr < got_hi


def test_ttest_two_single_mean_column_with_se():
    rng = np.random.default_rng(3)
    d = pd.DataFrame({"x": rng.normal(100, 12, 80),
                      "g": ["A"] * 40 + ["B"] * 40})
    res = tests_stats.ttest_two(d, "x", "g")
    t = _tbl(res, "t-test")
    labels = [c["label"] for c in t["columns"]]
    assert labels == ["Group", "N", "Mean", "SD", "SE", "p"], labels
    assert len(set(labels)) == len(labels)  # no duplicates
    a, b = d.loc[d.g == "A", "x"], d.loc[d.g == "B", "x"]
    row_a, row_b = t["rows"][0], t["rows"][1]
    assert abs(float(str(row_a[4]).replace(",", "")) - a.std(ddof=1) / np.sqrt(40)) < 5e-3
    assert abs(float(str(row_b[4]).replace(",", "")) - b.std(ddof=1) / np.sqrt(40)) < 5e-3


def test_generate_word_if_not_substring():
    """BUG 4: 'generate' used a plain substring check for 'if', so variable
    names containing 'if' (diff_score, gift_amount, tariff) silently produced
    an all-None column."""
    from app.models import Dataset
    from app.services import command_parser

    df = pd.DataFrame({"chol": [200.0, 240.0, 180.0, 260.0],
                       "age": [70.0, 40.0, 65.0, 30.0]})
    ds = Dataset(id=1, owner_id=1, name="t", meta={})

    # names containing "if" must compute normally
    res, df2, mut, _ = command_parser.execute(ds, df.copy(), "generate diff_score = chol / 100")
    assert mut
    assert df2["diff_score"].tolist() == [2.0, 2.4, 1.8, 2.6]

    res, df2, mut, _ = command_parser.execute(ds, df.copy(), "generate tariff = age + 5")
    assert mut and df2["tariff"].tolist() == [75.0, 45.0, 70.0, 35.0]

    # the actual failure mode: RHS *expression* references a variable containing "if"
    dfg = df.rename(columns={"chol": "gift_amount"})
    res, df4, mut, _ = command_parser.execute(ds, dfg.copy(), "generate bonus = gift_amount * 2")
    assert mut
    assert df4["bonus"].tolist() == [400.0, 480.0, 360.0, 520.0]  # old code: all-None

    # true conditional generate still works (Stata semantics: value where cond, NaN elsewhere)
    res, df3, mut, _ = command_parser.execute(ds, df.copy(), "generate senior = 1 if age > 60")
    assert mut
    assert df3["senior"].dropna().tolist() == [1.0, 1.0]
    assert int(df3["senior"].notna().sum()) == 2
    assert df3["senior"].isna().tolist() == [False, True, False, True]
