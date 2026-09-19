"""Command console parser validation."""
import numpy as np
import pandas as pd
import pytest

from app.models import Dataset
from app.services import command_parser


@pytest.fixture(scope="module")
def ctx():
    df = pd.DataFrame({
        "age": np.random.default_rng(1).normal(55, 10, 80).round(0),
        "chol": np.random.default_rng(2).normal(210, 30, 80).round(0),
        "sex": np.random.default_rng(3).choice(["Male", "Female"], 80),
        "outcome": np.random.default_rng(4).integers(0, 2, 80),
    })
    ds = Dataset(id=999, owner_id=1, name="test", n_rows=80, n_cols=4, meta={})
    return ds, df


def run(ds, df, cmd):
    return command_parser.execute(ds, df.copy(), cmd)


def test_summarize(ctx):
    ds, df = ctx
    res, df2, mut, _ = run(ds, df, "summarize age chol, detail")
    assert res and any(b["type"] == "table" for b in res["blocks"])
    assert not mut


def test_generate_and_sort(ctx):
    ds, df = ctx
    res, df2, mut, _ = run(ds, df, "generate chol2 = chol * 2")
    assert mut and "chol2" in df2.columns
    res, df3, mut, _ = run(ds, df2, "sort age")
    assert mut and df3["age"].is_monotonic_increasing


def test_keep_if(ctx):
    ds, df = ctx
    res, df2, mut, _ = run(ds, df, "keep if age > 60")
    assert mut and (df2["age"] > 60).all()


def test_ttest_by(ctx):
    ds, df = ctx
    res, df2, mut, _ = run(ds, df, "ttest chol, by(sex)")
    assert res and any(b["type"] == "table" for b in res["blocks"])


def test_unknown_command(ctx):
    ds, df = ctx
    with pytest.raises(ValueError):
        run(ds, df, "frobnicate x")


def test_help(ctx):
    ds, df = ctx
    res, _, _, _ = run(ds, df, "help")
    assert any(b["type"] == "text" for b in res["blocks"])
