"""Demo seed: demo user + sample medical dataset + meta-analysis dataset."""
from __future__ import annotations

import io

import numpy as np
import pandas as pd
from sqlalchemy.orm import Session

from .auth_utils import hash_password
from .models import Dataset, User, Variable
from .services import dataio

RNG = np.random.default_rng(42)


def cardio_dataframe(n: int = 250) -> pd.DataFrame:
    male = RNG.integers(0, 2, n)
    age = np.clip(RNG.normal(58 + 4 * male, 11, n), 28, 88).round(0)
    group = RNG.choice(["Drug", "Placebo"], n, p=[0.5, 0.5])
    tx = (group == "Drug").astype(int)
    sbp = np.clip(RNG.normal(142 - 10 * tx + 0.35 * (age - 55) + 4 * male, 14, n), 90, 220).round(0)
    dbp = np.clip(sbp * 0.62 + RNG.normal(0, 6, n), 55, 130).round(0)
    chol = np.clip(RNG.normal(215 - 12 * tx + 20 * male - 0.3 * (age - 60), 32, n), 120, 380).round(0)
    hdl = np.clip(RNG.normal(46 + 8 * (1 - male) - 4 * tx, 9, n), 20, 100).round(0)
    bmi = np.clip(RNG.normal(27.4 + 1.2 * male - 2 * tx * 0, 3.6, n), 16, 48).round(1)
    smoke = (RNG.random(n) < (0.32 + 0.12 * male)).astype(int)
    # outcome: logistic model
    z = (-9.2 + 0.055 * age + 0.018 * (sbp - 140) + 0.008 * chol + 0.7 * smoke
         - 0.35 * tx + 0.05 * (bmi - 27))
    p = 1 / (1 + np.exp(-z))
    outcome = (RNG.random(n) < p).astype(int)
    time = np.clip(RNG.exponential(52, n), 1, 120).round(1)
    event = np.where(outcome == 1, (RNG.random(n) < 0.85).astype(int), (RNG.random(n) < 0.08).astype(int))
    ecg = RNG.choice(["Normal", "ST-T abnormal", "LVH"], n, p=[0.62, 0.27, 0.11])
    site = RNG.choice([1, 2, 3], n)
    df = pd.DataFrame({
        "id": np.arange(1, n + 1),
        "age": age.astype(int),
        "sex": np.where(male == 1, "Male", "Female"),
        "group": group,
        "sbp": sbp.astype(int),
        "dbp": dbp.astype(int),
        "chol": chol.astype(int),
        "hdl": hdl.astype(int),
        "bmi": bmi,
        "smoking": smoke,
        "ecg": ecg,
        "outcome": outcome,
        "followup_months": time,
        "event": event,
        "site": site,
    })
    return df


def meta_dataframe() -> pd.DataFrame:
    # 12 pseudo-studies with mild heterogeneity
    true_theta, tau = 0.32, 0.08
    se = np.array([0.09, 0.11, 0.08, 0.14, 0.10, 0.13, 0.09, 0.16, 0.07, 0.12, 0.11, 0.09])
    u = np.linspace(-1.4, 1.2, 12)
    eff = true_theta + tau * u + se * RNG.normal(0, 1, 12)
    names = [f"Trial {chr(65+i)}" for i in range(12)]
    return pd.DataFrame({"study": names, "effect": eff.round(4), "se": se.round(4)})


def seed(db: Session) -> None:
    if db.query(User).filter(User.email == "demo@statmedx.app").first():
        return
    u = User(email="demo@statmedx.app", name="Demo researcher",
             hashed_password=hash_password("demo1234"), is_demo=True)
    db.add(u)
    db.commit()
    db.refresh(u)

    df = cardio_dataframe()
    ds = Dataset(owner_id=u.id, name="cardio_rct (sample)", n_rows=len(df), n_cols=len(df.columns),
                 description="250-patient cardiovascular RCT sample: treatment effect on BP, "
                             "lipids, binary outcome, survival. Seed data for trying every module.",
                 source_format="csv")
    db.add(ds)
    db.commit()
    db.refresh(ds)
    dataio.save_df(ds.id, df)
    dataio.sync_variables(db, ds, df)
    db.commit()

    mdf = meta_dataframe()
    mds = Dataset(owner_id=u.id, name="meta_studies (sample)", n_rows=len(mdf), n_cols=len(mdf.columns),
                  description="12 trials with log odds-ratio effect sizes and SEs — try the meta-analysis module.",
                  source_format="csv")
    db.add(mds)
    db.commit()
    db.refresh(mds)
    dataio.save_df(mds.id, mdf)
    dataio.sync_variables(db, mds, mdf)
    db.commit()
