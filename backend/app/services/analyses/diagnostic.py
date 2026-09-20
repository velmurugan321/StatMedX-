"""Module 07 — Diagnostic test accuracy from a 2×2 table (sensitivity, specificity,
PPV, NPV, accuracy, PLR, NLR with Wilson CIs)."""
from __future__ import annotations

import math

import pandas as pd

from ..blocks import num, pval, result, table, text


def wilson(k: int, n: int, z: float = 1.96) -> tuple[float, float]:
    if n == 0:
        return (float("nan"), float("nan"))
    p = k / n
    den = 1 + z * z / n
    centre = (p + z * z / (2 * n)) / den
    half = (z * math.sqrt(p * (1 - p) / n + z * z / (4 * n * n))) / den
    return (max(0.0, centre - half), min(1.0, centre + half))


def _accuracy_rows(tp: int, fp: int, fn: int, tn: int) -> tuple[list[list], str]:
    n = tp + fp + fn + tn
    prev = (tp + fn) / n if n else float("nan")
    sens = tp / (tp + fn) if (tp + fn) else float("nan")
    spec = tn / (tn + fp) if (tn + fp) else float("nan")
    ppv = tp / (tp + fp) if (tp + fp) else float("nan")
    npv = tn / (tn + fn) if (tn + fn) else float("nan")
    acc = (tp + tn) / n if n else float("nan")
    plr = sens / (1 - spec) if (1 - spec) else float("inf")
    nlr = (1 - sens) / spec if spec else float("inf")
    lplr = 0 if plr == 0 else math.log(plr) if plr not in (0, float("inf")) else float("inf")
    lnlr = math.log(nlr) if nlr > 0 else float("-inf")

    def row(name, val, k, n, note):
        lo, hi = wilson(k, n)
        return [name, num(val, 4), f"[{num(lo, 3)}, {num(hi, 3)}]", note]

    rows = [
        row("Sensitivity", sens, tp, tp + fn, "TP/(TP+FN)"),
        row("Specificity", spec, tn, tn + fp, "TN/(TN+FP)"),
        row("PPV", ppv, tp, tp + fp, "TP/(TP+FP)"),
        row("NPV", npv, tn, tn + fn, "TN/(TN+FN)"),
        row("Accuracy", acc, tp + tn, n, "(TP+TN)/N"),
        ["PLR (+ likelihood ratio)", num(plr, 4), f"[{num(math.exp(lplr - 1.96 * lr_se(sens, 1 - spec, tp + fn, tn + fp)), 3)}, {num(math.exp(lplr + 1.96 * lr_se(sens, 1 - spec, tp + fn, tn + fp)), 3)}]", "Sens/(1−Spec)"],
        ["NLR (− likelihood ratio)", num(nlr, 4), f"[{num(math.exp(lnlr - 1.96 * lr_se(1 - sens, spec, tp + fn, tn + fp)), 3)}, {num(math.exp(lnlr + 1.96 * lr_se(1 - sens, spec, tp + fn, tn + fp)), 3)}]", "(1−Sens)/Spec"],
        ["Disease prevalence", num(prev, 4), "—", "(TP+FN)/N"],
    ]
    return rows, n


def lr_se(sens_or_comp: float, spec_or_comp: float, n1: int, n0: int) -> float:
    """SE of log likelihood ratio (normal approximation on log scale)."""
    try:
        var = (1 - sens_or_comp) / (sens_or_comp * n1) + (1 - spec_or_comp) / (spec_or_comp * n0)
        return math.sqrt(max(var, 0.0))
    except ZeroDivisionError:
        return float("nan")


def twobytwo(tp: int, fp: int, fn: int, tn: int, labels: tuple[str, str] = ("Test +", "Disease +")) -> dict:
    from scipy import stats
    rows, n = _accuracy_rows(tp, fp, fn, tn)
    # exact McNemar not needed; chi2 on the table
    chi, p, dof, exp = stats.chi2_contingency([[tp, fn], [fp, tn]], correction=False)
    fisher_p = stats.fisher_exact([[tp, fn], [fp, tn]])[1] if min(tp + fn, fp + tn) > 0 else float("nan")
    blocks = [
        table("2×2 diagnostic table", ["", f"{labels[1]} +", f"{labels[1]} −", "Total"], [
            [labels[0] + " +", tp, fp, tp + fp],
            [labels[0] + " −", fn, tn, fn + tn],
            ["Total", tp + fn, fp + tn, n],
        ]),
        table("Diagnostic accuracy measures (95% CI)", ["Measure", "Estimate", "95% CI", "Formula"], rows),
        text(f"Association test: Pearson χ²(1) = {chi:.3f}, p = {pval(p)};  Fisher exact p = {pval(fisher_p)}"),
    ]
    return result("Diagnostic test accuracy (2×2)", blocks)


def from_variables(df: pd.DataFrame, test_var: str, gold_var: str,
                   test_pos=None, gold_pos=None, threshold=None) -> dict:
    d = df[[test_var, gold_var]].dropna()
    tv = pd.to_numeric(d[test_var], errors="coerce") if test_pos or threshold else d[test_var]
    if threshold is not None:
        tpos = tv >= threshold
    elif test_pos is not None:
        tpos = d[test_var].astype(str) == str(test_pos)
    else:
        tpos = d[test_var].astype(bool)
    if gold_pos is not None:
        gpos = d[gold_var].astype(str) == str(gold_pos)
    else:
        gpos = pd.to_numeric(d[gold_var], errors="coerce").astype(bool)
    tp = int((tpos & gpos).sum())
    fp = int((tpos & ~gpos).sum())
    fn = int((~tpos & gpos).sum())
    tn = int((~tpos & ~gpos).sum())
    return twobytwo(tp, fp, fn, tn, labels=(test_var, gold_var))
