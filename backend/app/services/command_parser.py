"""Module 12 — Command console: Stata-style command parser & executor.

Supported (subset, growing):
  help | describe | list [n] | browse
  summarize varlist [, detail]        (alias: sum)
  tabulate a [b] [, chi2 fisher]      (alias: tab)
  ttest var == num | ttest var, by(g) | ttest v1 == v2
  ranksum var, by(g) | signrank v1 == v2
  oneway y g | anova y g | kwallis y, by(g)
  correlate varlist [, spearman]      (alias: corr, pwcorr)
  regress y x1 x2 ...                 (alias: reg)
  logistic y x1 ... | logit y x1 ...
  poisson y x1 ... [, robust] | nbreg y x1 ... | mlogit y x1 ...
  roc y score [score2]
  stset timevar, failure(eventvar)    |  sts graph [, by(g)] | sts test g  |  stcox x1 ...
  generate name = expr  (alias: gen)  |  recode var (old=new) [...] , gen(name)
  replace var = expr if cond | keep if cond | drop if cond | sort varlist
  drop varlist | rename old new | label variable v "label"
  histogram var [, by(g)] | graph box var [, by(g)] | graph bar var [, by(g)]
  scatter y x [, by(g)]
  duplicates report|drop | misstable summarize | history | clear (stset reset)
"""
from __future__ import annotations

import shlex

import numpy as np
import pandas as pd

from ..models import Dataset
from . import analyses
from .blocks import num
from .dataio import save_df, sync_variables

HELP_TEXT = """<b>StatMedX command console — supported commands</b><br>
<code>summarize age bp, detail</code> — descriptive statistics<br>
<code>tabulate sex outcome, chi2 fisher</code> — crosstab + tests<br>
<code>ttest bp, by(group)</code> / <code>ttest bp == 120</code> / <code>ttest pre == post</code><br>
<code>ranksum bp, by(group)</code> / <code>signrank pre == post</code><br>
<code>oneway chol group</code> / <code>kwallis chol, by(group)</code><br>
<code>correlate age chol bmi</code> / <code>pwcorr age chol, spearman</code><br>
<code>regress outcome age chol</code> / <code>logistic out age sex</code><br>
<code>poisson events age group, robust</code> / <code>nbreg</code> / <code>mlogit</code><br>
<code>roc outcome score1 score2</code><br>
<code>stset time, failure(event)</code> → <code>sts graph, by(group)</code> / <code>sts test group</code> / <code>stcox age sex</code><br>
<code>generate bmi = weight / (height/100)^2</code> / <code>recode sex (1=0) (2=1), gen(sex2)</code><br>
<code>keep if age &gt; 40</code> / <code>drop if bmi &gt; 40</code> / <code>sort age</code><br>
<code>histogram age</code> / <code>graph box chol, by(group)</code> / <code>scatter chol age</code><br>
<code>duplicates report</code> / <code>misstable summarize</code> / <code>describe</code> / <code>list 10</code><br>
<code>psmatch treat y x1 x2, caliper(0.2)</code> — propensity matching · <code>iptw treat y x1 x2</code> — weighting<br>
<code>svyset weight [, strata(s) psu(p)]</code> → <code>svymean y</code> / <code>svyprop g</code> / <code>svyreg y x1</code> / <code>svylogit y x1</code>"""


class CommandContext:
    """Per-dataset session state (survival settings, survey design)."""

    def __init__(self, dataset: Dataset):
        self.dataset = dataset
        meta = dataset.meta or {}
        self.stset = meta.get("stset")
        self.svyset = meta.get("svyset")

    def save_session(self):
        meta = dict(self.dataset.meta or {})
        if self.stset:
            meta["stset"] = self.stset
        else:
            meta.pop("stset", None)
        if self.svyset:
            meta["svyset"] = self.svyset
        else:
            meta.pop("svyset", None)
        self.dataset.meta = meta


def tokenize(cmd: str) -> list[str]:
    try:
        return shlex.split(cmd.replace("\\", " "))
    except ValueError:
        return cmd.split()


def split_options(rest: str) -> tuple[str, dict]:
    """Split 'args, opt1 opt2' -> (args, {opt1:True,...})."""
    if "," in rest:
        args, opts = rest.split(",", 1)
        opts_d = {}
        for o in opts.strip().split():
            if "(" in o and o.endswith(")"):
                k, v = o.split("(", 1)
                opts_d[k.strip()] = v[:-1]
            else:
                opts_d[o] = True
        return args.strip(), opts_d
    return rest.strip(), {}


def parse_if(expr: str | None):
    return expr


def execute(dataset: Dataset, df: pd.DataFrame, cmdline: str) -> tuple[dict, pd.DataFrame, bool, str]:
    """Returns (result_dict, possibly modified df, mutated?, message)."""
    cmdline = cmdline.strip()
    if not cmdline:
        return None, df, False, ""
    parts = tokenize(cmdline)
    cmd = parts[0].lower()
    rest = cmdline[len(parts[0]):].strip()
    args, opts = split_options(rest)
    atoks = tokenize(args)
    ctx = CommandContext(dataset)
    mutated = False
    title_suffix = cmdline

    def R(blocks, title=None):
        return {"title": title or f"▶ {cmdline}", "command": cmdline, "blocks": blocks}

    # ---------- help / info ----------
    if cmd in ("help", "h"):
        return R([{"type": "text", "content": HELP_TEXT}]), df, mutated, ""
    if cmd == "describe":
        from .analyses.descriptive import frequencies
        rows = []
        for v in df.columns:
            s = df[v]
            rows.append([v, "numeric" if pd.api.types.is_numeric_dtype(s) else "string",
                         int(s.notna().sum()), int(s.isna().sum()),
                         num(s.min()) if pd.api.types.is_numeric_dtype(s) else "",
                         num(s.max()) if pd.api.types.is_numeric_dtype(s) else ""])
        return R([{"type": "table", "name": "Variables",
                   "columns": [{"key": c, "label": c} for c in ["Variable", "Type", "N", "Missing", "Min", "Max"]],
                   "rows": rows, "note": f"{len(df)} observations × {len(df.columns)} variables"}],
                 title="describe"), df, mutated, ""
    if cmd in ("list", "browse"):
        n = min(int(atoks[0]) if atoks and atoks[0].isdigit() else 10, 100)
        from .dataio import df_to_records
        rows = df_to_records(df.head(n))
        return R([{"type": "table", "name": f"First {n} rows",
                   "columns": [{"key": c, "label": c} for c in df.columns],
                   "rows": [[("" if v is None else v) for v in r] for r in rows],
                   "note": f"Showing {min(n, len(df))} of {len(df)} rows"}],
                 title=f"list {n}"), df, mutated, ""
    if cmd == "history":
        return R([{"type": "text", "content": "Use the ⏱ history panel below the console."}]), df, mutated, ""
    if cmd == "clear":
        ctx.stset = None
        ctx.svyset = None
        ctx.save_session()
        return R([{"type": "text", "content": "Session settings cleared (stset, svyset reset)."}]), df, mutated, ""

    # ---------- data management ----------
    if cmd in ("generate", "gen"):
        try:
            lhs, rhs = args.split("=", 1)
            name = lhs.strip()
            expr = rhs.strip()
            res = df.eval(expr) if "if" not in expr else None
            df[name] = res
            mutated = True
            return R([{"type": "text", "content": f"Variable <b>{name}</b> created "
                                                f"({int(df[name].notna().sum())} non-missing)."}]), df, True, ""
        except Exception as e:
            raise ValueError(f"generate failed: {e}")
    if cmd == "replace":
        try:
            lhs, rhs = args.split("=", 1)
            var, cond = (lhs.split("if", 1) + [""])[:2]
            var = var.strip()
            expr = rhs.strip()
            if cond.strip():
                mask = df.eval(cond.strip())
            else:
                mask = pd.Series(True, index=df.index)
            df.loc[mask, var] = df.loc[mask].eval(expr)
            return R([{"type": "text", "content": f"Replaced {int(mask.sum())} values in {var}."}]), df, True, ""
        except Exception as e:
            raise ValueError(f"replace failed: {e}")
    if cmd == "recode":
        try:
            head, opts2 = split_options(cmdline.split(None, 1)[1])
            var = atoks[0]
            new_name = opts2.get("gen", var + "_r") if isinstance(opts2, dict) else var + "_r"
            # parse (old=new) pairs
            pairs = []
            tok = head[len(var):]
            import re as _re
            for m in _re.finditer(r"\(([^)]+)\)", tok):
                old, new = m.group(1).split("=", 1)
                pairs.append((old.strip(), new.strip()))
            s = df[var]
            out = s.copy()
            for old, new in pairs:
                if old.lower() in ("min", "max") or "/" in old:
                    lo_hi = old.split("/")
                    lo = -np.inf if lo_hi[0] == "min" else float(lo_hi[0])
                    hi = np.inf if lo_hi[1] == "max" else float(lo_hi[1])
                    out[(pd.to_numeric(s, errors="coerce") >= lo) & (pd.to_numeric(s, errors="coerce") <= hi)] = pd.to_numeric(new, errors="coerce")
                elif old.lower() == "missing":
                    out[s.isna()] = pd.to_numeric(new, errors="coerce")
                else:
                    try:
                        out[s == float(old)] = pd.to_numeric(new, errors="coerce")
                    except ValueError:
                        out[s.astype(str) == old] = new
            if "gen" in (opts2 if isinstance(opts2, dict) else {}):
                df[new_name] = out
                mutated = True
                msg = f"Generated <b>{new_name}</b> from {var}."
            else:
                df[var] = out
                mutated = True
                msg = f"Recoded {var} in place ({len(pairs)} rules)."
            return R([{"type": "text", "content": msg}]), df, True, ""
        except Exception as e:
            raise ValueError(f"recode failed: {e}")
    if cmd in ("keep", "drop"):
        if atoks and "if" not in cmdline[len(parts[0]):]:
            # keep/drop variables (columns)
            cols = atoks
            df = df.drop(columns=cols) if cmd == "drop" else df[cols]
            mutated = True
            return R([{"type": "text", "content": f"{cmd} variables: {', '.join(cols)}. Now {df.shape[1]} variables."}]), df, True, ""
        cond = args.split("if", 1)[1].strip() if "if" in args else None
        if not cond:
            raise ValueError(f"{cmd} requires 'if <condition>' or a variable list")
        mask = df.eval(cond)
        df = df[mask] if cmd == "keep" else df[~mask]
        mutated = True
        return R([{"type": "text", "content": f"{cmd} applied — {len(df)} observations remain."}]), df, True, ""
    if cmd == "sort":
        ascending = True
        vs = atoks
        df = df.sort_values(vs, ascending=ascending).reset_index(drop=True)
        mutated = True
        return R([{"type": "text", "content": f"Sorted by {', '.join(vs)}."}]), df, True, ""
    if cmd == "rename":
        old, new = atoks[0], atoks[1]
        df = df.rename(columns={old: new})
        mutated = True
        return R([{"type": "text", "content": f"Renamed {old} → {new}."}]), df, True, ""
    if cmd == "duplicates":
        what = atoks[0] if atoks else "report"
        dups = df.duplicated(keep=False)
        if what == "drop":
            before = len(df)
            df = df.drop_duplicates().reset_index(drop=True)
            mutated = True
            return R([{"type": "text", "content": f"Dropped {before - len(df)} duplicate rows — {len(df)} remain."}]), df, True, ""
        return R([{"type": "text", "content": f"{int(dups.sum())} rows are part of duplicate groups "
                                              f"({int(df.duplicated().sum())} redundant). Use <code>duplicates drop</code> to remove."}]), df, mutated, ""
    if cmd == "misstable":
        rows = []
        for v in df.columns:
            s = df[v]
            rows.append([v, int(s.isna().sum()), f"{100 * s.isna().mean():.1f}%"])
        return R([{"type": "table", "name": "Missing values",
                   "columns": [{"key": c, "label": c} for c in ["Variable", "Missing", "% missing"]],
                   "rows": rows}], title="misstable summarize"), df, mutated, ""

    # ---------- survival ----------
    if cmd == "stset":
        try:
            tvar = atoks[0]
            fail = opts.get("failure", opts.get("fail")) if isinstance(opts, dict) else None
            if not fail:
                raise ValueError("stset requires , failure(var)")
            ctx.stset = {"time": tvar, "event": fail}
            ctx.save_session()
            n = int((df[fail] > 0).sum())
            return R([{"type": "text", "content":
                       f"Survival data st-set: time = <b>{tvar}</b>, failure = <b>{fail}</b>; "
                       f"{n} events of {len(df)} observations."}]), df, mutated, ""
        except ValueError as e:
            raise
    if cmd == "sts":
        if not ctx.stset:
            raise ValueError("Run 'stset timevar, failure(eventvar)' first.")
        sub = tokenize(args) if args else []
        if sub and sub[0] in ("graph",):
            by = opts.get("by") if isinstance(opts, dict) else None
            res = analyses.run("km", df, {"time": ctx.stset["time"], "event": ctx.stset["event"], "group": by})
            return res, df, mutated, ""
        if sub and sub[0] == "test":
            by = sub[1] if len(sub) > 1 else (opts.get("by") if isinstance(opts, dict) else None)
            res = analyses.run("km", df, {"time": ctx.stset["time"], "event": ctx.stset["event"], "group": by})
            return res, df, mutated, ""
        raise ValueError("sts graph [, by(g)] or sts test g")
    if cmd == "stcox":
        if not ctx.stset:
            raise ValueError("Run 'stset timevar, failure(eventvar)' first.")
        res = analyses.run("cox", df, {"time": ctx.stset["time"], "event": ctx.stset["event"],
                                       "covariates": atoks})
        return res, df, mutated, ""

    # ---------- statistics ----------
    if cmd in ("summarize", "sum"):
        vs = atoks
        if not vs:
            vs = [c for c in df.columns if pd.api.types.is_numeric_dtype(df[c])][:8]
        return analyses.run("descriptive_summarize", df, {"variables": vs, "detail": bool(opts.get("detail"))}), df, mutated, ""
    if cmd in ("tabulate", "tab"):
        if len(atoks) >= 2:
            return analyses.run("chi2", df, {"row": atoks[0], "col": atoks[1],
                                             "fisher": bool(opts.get("fisher"))}), df, mutated, ""
        return analyses.run("descriptive_freq", df, {"variables": [atoks[0]]}), df, mutated, ""
    if cmd == "ttest":
        if "==" in args:
            lhs, rhs = args.split("==", 1)
            l, r = lhs.strip(), rhs.strip()
            if r.replace(".", "", 1).replace("-", "", 1).isdigit():
                return analyses.run("ttest_one", df, {"variable": l, "testvalue": float(r)}), df, mutated, ""
            return analyses.run("ttest_paired", df, {"v1": l, "v2": r}), df, mutated, ""
        if "by(" in cmdline:
            var = atoks[0]
            g = opts.get("by") if isinstance(opts, dict) else None
            return analyses.run("ttest_two", df, {"variable": var, "group": g}), df, mutated, ""
        raise ValueError("ttest forms: 'ttest var == num', 'ttest v1 == v2', 'ttest var, by(group)'")
    if cmd == "ranksum":
        return analyses.run("mannwhitney", df, {"variable": atoks[0], "group": opts.get("by")}), df, mutated, ""
    if cmd == "signrank":
        l, r = args.split("==", 1)
        return analyses.run("wilcoxon", df, {"v1": l.strip(), "v2": r.strip()}), df, mutated, ""
    if cmd in ("oneway", "anova"):
        if cmd == "oneway":
            return analyses.run("anova", df, {"variable": atoks[0], "group": atoks[1]}), df, mutated, ""
        return analyses.run("anova", df, {"variable": atoks[0], "group": atoks[1]}), df, mutated, ""
    if cmd == "kwallis":
        return analyses.run("kruskal", df, {"variable": atoks[0], "group": opts.get("by")}), df, mutated, ""
    if cmd in ("correlate", "corr"):
        return analyses.run("corr_matrix", df, {"variables": atoks, "method": "spearman" if opts.get("spearman") else "pearson"}), df, mutated, ""
    if cmd == "pwcorr":
        return analyses.run("corr_matrix", df, {"variables": atoks, "method": "spearman" if opts.get("spearman") else "pearson"}), df, mutated, ""
    if cmd in ("regress", "reg"):
        return analyses.run("reg_linear", df, {"y": atoks[0], "xs": atoks[1:]}), df, mutated, ""
    if cmd in ("logistic", "logit"):
        return analyses.run("reg_logistic", df, {"y": atoks[0], "xs": atoks[1:]}), df, mutated, ""
    if cmd == "poisson":
        return analyses.run("reg_poisson", df, {"y": atoks[0], "xs": atoks[1:],
                                                "robust": bool(opts.get("robust") or opts.get("vce_robust"))}), df, mutated, ""
    if cmd in ("rpoisson", "glm_robust"):
        return analyses.run("reg_poisson", df, {"y": atoks[0], "xs": atoks[1:], "robust": True}), df, mutated, ""
    if cmd == "nbreg":
        return analyses.run("reg_negbin", df, {"y": atoks[0], "xs": atoks[1:]}), df, mutated, ""
    if cmd == "mlogit":
        return analyses.run("reg_multinomial", df, {"y": atoks[0], "xs": atoks[1:]}), df, mutated, ""
    if cmd == "roc":
        return analyses.run("roc", df, {"y": atoks[0], "score_vars": atoks[1:]}), df, mutated, ""
    if cmd == "meta":
        # meta effectvar sevar [studyvar]
        p = {"effect_col": atoks[0], "se_col": atoks[1],
             "study_col": atoks[2] if len(atoks) > 2 else None}
        return analyses.run("meta", df, p), df, mutated, ""
    if cmd in ("mixed", "xtmixed"):
        # mixed y fixed..., || group:
        main_part, re_part = args.split("||", 1) if "||" in args else (args, "")
        toks = tokenize(main_part)
        group = re_part.split(":", 1)[0].strip() if re_part else None
        return analyses.run("mixed", df, {"y": toks[0], "fixed": toks[1:], "group": group}), df, mutated, ""
    if cmd == "gee":
        toks = tokenize(args)
        return analyses.run("gee", df, {"y": toks[0], "predictors": toks[1:-1], "group": toks[-1]}), df, mutated, ""
    if cmd == "histogram":
        return analyses.run("graph_histogram", df, {"variable": atoks[0], "bins": int(opts.get("bin", 20)) if isinstance(opts, dict) and str(opts.get("bin", "")).isdigit() else 20, "by": opts.get("by") if isinstance(opts, dict) else None}), df, mutated, ""
    if cmd == "scatter":
        return analyses.run("graph_scatter", df, {"x": atoks[1], "y": atoks[0],
                                                  "by": opts.get("by") if isinstance(opts, dict) else None}), df, mutated, ""
    if cmd == "graph":
        kind = atoks[0]
        var = atoks[1] if len(atoks) > 1 else None
        by = opts.get("by") if isinstance(opts, dict) else None
        if kind == "box":
            return analyses.run("graph_box", df, {"variable": var, "by": by}), df, mutated, ""
        if kind == "bar":
            return analyses.run("graph_bar", df, {"variable": var, "by": by}), df, mutated, ""
        if kind == "histogram":
            return analyses.run("graph_histogram", df, {"variable": var, "by": by}), df, mutated, ""
        raise ValueError("graph box|bar|histogram var [, by(g)]")

    # ---------- propensity score ----------
    if cmd in ("psmatch", "iptw", "ps"):
        toks = tokenize(args)
        if len(toks) < 3:
            raise ValueError(f"{cmd} treatment outcome covariates… — need treatment, outcome, ≥1 covariate")
        treat, outcome = toks[0], toks[1]
        covs = toks[2:]
        method = "match" if cmd == "psmatch" else "iptw"
        calv = 0.2
        if isinstance(opts, dict) and opts.get("caliper"):
            try:
                calv = float(opts["caliper"])
            except ValueError:
                pass
        return analyses.run("propensity", df, {"treatment": treat, "outcome": outcome,
                                               "covariates": covs, "method": method, "caliper": calv}), df, mutated, ""

    # ---------- survey ----------
    if cmd == "svyset":
        wvar = atoks[0] if atoks else None
        if not wvar:
            raise ValueError("svyset weightvar [, strata(s) psu(p)]")
        ctx.svyset = {"weight": wvar, "strata": opts.get("strata") if isinstance(opts, dict) else None,
                      "psu": opts.get("psu") if isinstance(opts, dict) else None}
        ctx.save_session()
        return R([{"type": "text", "content":
                   f"Survey design set: weight = <b>{wvar}</b>"
                   + (f", strata = <b>{ctx.svyset['strata']}</b>" if ctx.svyset["strata"] else "")
                   + (f", PSU = <b>{ctx.svyset['psu']}</b>" if ctx.svyset["psu"] else "") + "."}]), df, mutated, ""
    if cmd in ("svymean", "svyprop", "svyreg", "svylogit", "svytotal"):
        if not ctx.svyset:
            raise ValueError("Run 'svyset weightvar [, strata(s) psu(p)]' first.")
        sv = ctx.svyset
        if cmd in ("svymean", "svytotal"):
            return analyses.run("survey_mean", df, {"var": atoks[0], "weight": sv["weight"],
                                                    "strata": sv.get("strata"), "psu": sv.get("psu")}), df, mutated, ""
        if cmd == "svyprop":
            return analyses.run("survey_prop", df, {"var": atoks[0], "weight": sv["weight"],
                                                    "strata": sv.get("strata"), "psu": sv.get("psu")}), df, mutated, ""
        fam = "binomial" if cmd == "svylogit" or (isinstance(opts, dict) and opts.get("binomial")) else "gaussian"
        return analyses.run("survey_reg", df, {"y": atoks[0], "xs": atoks[1:], "weight": sv["weight"],
                                               "strata": sv.get("strata"), "psu": sv.get("psu"),
                                               "family": fam}), df, mutated, ""

    raise ValueError(f"Command '{cmd}' not recognized. Type <code>help</code> for the list of commands.")
