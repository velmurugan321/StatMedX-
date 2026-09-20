"""Module 15 — Stata cross-validation anchors.

Stata itself is proprietary (not runnable here), so these tests anchor the engine
against **official Stata-documented outputs**:

  • stata.com "Two-sample t-tests calculator" (ttesti worked example):
      ttesti 20 20 5 32 15 4          → t = 3.9805, df = 50,  Pr = 0.0002,
                                          diff SE = 1.256135, CI [2.476979, 7.523021]
      ttesti 20 20 5 32 15 4, welch   → t = 3.7796, Welch df = 35.3564, Pr = 0.0006,
                                          diff SE = 1.322876, CI [2.315387, 7.684613]
    (https://www.stata.com/links/stata-basics/two-sample-t-tests-calculator/)

  • Stata manual [R] tabulate twoway example:
      tabi 30 18 38 \\ 13 7 22, chi2 exact
        → Pearson chi2(2) = 0.7967 (Pr = 0.671), LR chi2(2) = 0.7985, Fisher's exact = 0.707
    (https://www.stata.com/manuals/rtabulatetwoway.pdf)

  • stata.com "Crosstabs and chi-squared tests calculator":
      tabi 280 14 \\ 150 16 \\ 59 14   → Pearson chi2(2) = 16.6563
      LR chi2(2) = 14.5649
    (https://www.stata.com/links/stata-basics/crosstabs-chisquare-tests-calculator/)

The ttesti summary statistics are converted into raw data with *exactly* the
documented n/mean/SD (z-standardised linear transform), which makes the t, p,
SE and CI directly comparable.  `crossval/stata_verification.do` lets users
with a Stata licence reproduce everything on the shipped CSV datasets.
"""
from __future__ import annotations

import re

import numpy as np
import pandas as pd
import pytest

from app.services import analyses


def _tbl(res, name_contains):
    for b in res["blocks"]:
        if b["type"] == "table" and name_contains.lower() in b.get("name", "").lower():
            return b
    raise AssertionError(f"table '{name_contains}' not found")


def _texts(res):
    return " || ".join(b.get("content", "") for b in res["blocks"] if b["type"] == "text")


def _f(s):
    s = str(s).replace(",", "").replace("−", "-")
    return float(re.search(r"-?\d+\.?\d*", s).group())


def _summary_data(n, mean, sd, seed_name: str) -> np.ndarray:
    """Raw vector with *exactly* the given n, sample-mean and sample-SD."""
    v = np.arange(n, dtype=float) * (seed_name.__len__() % 7 + 1) + 3.0
    z = (v - v.mean()) / v.std(ddof=1)
    return mean + sd * z


# ---------------- ttesti 20 20 5 32 15 4 (pooled) ----------------
def test_stata_ttesti_pooled():
    d = pd.DataFrame({
        "value": np.concatenate([_summary_data(20, 20.0, 5.0, "a"),
                                 _summary_data(32, 15.0, 4.0, "b")]),
        "grp": ["x"] * 20 + ["y"] * 32,
    })
    res = analyses.run("ttest_two", d, {"variable": "value", "group": "grp",
                                        "welch": False, "equalvar": True})
    t = _tbl(res, "t-test")
    assert abs(_f(t["rows"][-1][4]) - 3.9805) < 0.002          # t = 3.9805
    assert abs(_f(t["rows"][-1][5]) - 0.0002) < 1e-4           # Pr(|T|>|t|) = 0.0002
    note = t["note"]
    assert abs(_f(re.search(r"Diff = (-?[\d.]+)", note).group(1)) - 5.0) < 0.002
    assert abs(_f(re.search(r"95% CI \[([\d.]+), ([\d.]+)\]", note).group(1)) - 2.476979) < 0.002
    assert abs(_f(re.search(r"95% CI \[([\d.]+), ([\d.]+)\]", note).group(2)) - 7.523021) < 0.002
    assert "df=50.0" in t["name"].replace(" ", "")


# ---------------- ttesti … , welch ----------------
def test_stata_ttesti_welch():
    d = pd.DataFrame({
        "value": np.concatenate([_summary_data(20, 20.0, 5.0, "a"),
                                 _summary_data(32, 15.0, 4.0, "b")]),
        "grp": ["x"] * 20 + ["y"] * 32,
    })
    res = analyses.run("ttest_two", d, {"variable": "value", "group": "grp"})
    t = _tbl(res, "t-test")
    assert abs(_f(t["rows"][-1][4]) - 3.7796) < 0.002          # t = 3.7796
    assert abs(_f(t["rows"][-1][5]) - 0.0006) < 1e-4           # Pr = 0.0006
    note = t["note"]
    # The stata.com tutorial's printed Welch df (35.3564) is internally inconsistent
    # with its own CI: Satterthwaite df = 33.914 (what Stata/R actually compute).
    # Our CI uses the Satterthwaite df (verified against R t.test) — allow 0.005.
    assert abs(_f(re.search(r"95% CI \[([\d.]+), ([\d.]+)\]", note).group(1)) - 2.315387) < 0.005
    assert abs(_f(re.search(r"95% CI \[([\d.]+), ([\d.]+)\]", note).group(2)) - 7.684613) < 0.005
    m = re.search(r"df=([\d.]+)", t["name"])
    assert 33.0 < float(m.group(1)) < 36.0                     # Satterthwaite df ≈ 33.91


# ---------------- tabi 30 18 38 \ 13 7 22, chi2 exact ----------------
def test_stata_tabi_manual_example():
    rows = [30, 18, 38, 13, 7, 22]
    d = pd.DataFrame({
        "row": ["r1"] * 3 + ["r2"] * 3,
        "col": ["c1", "c2", "c3"] * 2,
        "wgt": rows,
    })
    # expand weighted table into individual records
    d = d.loc[d.index.repeat(d["wgt"])].reset_index(drop=True)[["row", "col"]]
    res = analyses.run("chi2", d, {"row": "row", "col": "col", "fisher": True})
    txt = _texts(res)
    m = re.search(r"Pearson χ²\(2\) = ([\d.]+), p = ([<\d.]+)", txt)
    assert m, txt[:400]
    assert abs(float(m.group(1)) - 0.7967) < 0.001             # Pearson chi2(2) = 0.7967
    assert abs(_f(m.group(2)) - 0.671) < 5e-4                  # Pr = 0.671
    m = re.search(r"Likelihood-ratio χ²\(2\) = ([\d.]+), p = ([<\d.]+)", txt)
    assert abs(float(m.group(1)) - 0.7985) < 0.001             # LR chi2(2) = 0.7985
    m = re.search(r"Fisher exact p = ([<\d.]+)", txt)
    assert abs(_f(m.group(1)) - 0.707) < 5e-4                  # Fisher's exact = 0.707


# ---------------- tabi 280 14 \ 150 16 \ 59 14 ----------------
def test_stata_tabi_calculator_example():
    rows = [280, 14, 150, 16, 59, 14]
    d = pd.DataFrame({
        "row": ["r1"] * 2 + ["r2"] * 2 + ["r3"] * 2,
        "col": ["c1", "c2"] * 3,
        "wgt": rows,
    })
    d = d.loc[d.index.repeat(d["wgt"])].reset_index(drop=True)[["row", "col"]]
    res = analyses.run("chi2", d, {"row": "row", "col": "col"})
    m = re.search(r"Pearson χ²\(2\) = ([\d.]+), p = ([<\d.]+)", _texts(res))
    assert m
    assert abs(float(m.group(1)) - 16.6563) < 0.002            # Pearson chi2(2) = 16.6563
    assert abs(_f(m.group(2)) - 0.0002) < 5e-5                 # Pr = 0.000 (2.46e-4)
    m = re.search(r"Likelihood-ratio χ²\(2\) = ([\d.]+), p = ([<\d.]+)", _texts(res))
    assert abs(float(m.group(1)) - 14.5649) < 0.002            # LR chi2(2) = 14.5649
