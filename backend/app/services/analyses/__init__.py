"""Analysis module registry — maps module ids to callables."""
from __future__ import annotations

import pandas as pd

from . import correlation, descriptive, diagnostic, graphics, meta, propensity, regression, roc, survey, survival, tests_stats, advanced


def run(module: str, df: pd.DataFrame, params: dict) -> dict:
    """Dispatch an analysis request. Raises ValueError with a friendly message on bad input."""
    p = params

    if module == "descriptive_summarize":
        return descriptive.summarize(df, p["variables"], detail=p.get("detail", False))
    if module == "descriptive_freq":
        return descriptive.frequencies(df, p["variables"])
    if module == "crosstab":
        return descriptive.crosstab(df, p["row"], p["col"], chi2=p.get("chi2", True),
                                    fisher=p.get("fisher", False), percent=p.get("percent", True))
    if module == "ttest_one":
        return tests_stats.ttest_one(df, p["variable"], float(p.get("testvalue", 0)))
    if module == "ttest_two":
        return tests_stats.ttest_two(df, p["variable"], p["group"],
                                     welch=p.get("welch", True), equalvar=p.get("equalvar", False))
    if module == "ttest_paired":
        return tests_stats.ttest_paired(df, p["v1"], p["v2"])
    if module == "mannwhitney":
        return tests_stats.mannwhitney(df, p["variable"], p["group"])
    if module == "wilcoxon":
        return tests_stats.wilcoxon(df, p["v1"], p["v2"])
    if module == "anova":
        return tests_stats.anova(df, p["variable"], p["group"], posthoc=p.get("posthoc", True))
    if module == "kruskal":
        return tests_stats.kruskal(df, p["variable"], p["group"])
    if module == "chi2":
        return descriptive.crosstab(df, p["row"], p["col"], chi2=True, fisher=p.get("fisher", False))
    if module == "corr_pair":
        return correlation.corr_pair(df, p["x"], p["y"])
    if module == "corr_matrix":
        return correlation.correlate(df, p["variables"], method=p.get("method", "pearson"))
    if module == "reg_linear":
        return regression.linear(df, p["y"], p["xs"], robust=p.get("robust", False))
    if module == "reg_logistic":
        return regression.logistic(df, p["y"], p["xs"])
    if module == "reg_poisson":
        return regression.poisson(df, p["y"], p["xs"], robust=p.get("robust", False))
    if module == "reg_negbin":
        return regression.negbin(df, p["y"], p["xs"])
    if module == "reg_multinomial":
        return regression.multinomial(df, p["y"], p["xs"])
    if module == "diag_2x2":
        return diagnostic.twobytwo(int(p["tp"]), int(p["fp"]), int(p["fn"]), int(p["tn"]),
                                   labels=(p.get("test_label", "Test +"), p.get("gold_label", "Disease +")))
    if module == "diag_vars":
        return diagnostic.from_variables(df, p["test_var"], p["gold_var"],
                                         test_pos=p.get("test_pos"), gold_pos=p.get("gold_pos"),
                                         threshold=p.get("threshold"))
    if module == "roc":
        return roc.roc_analysis(df, p["y"], p["score_vars"], thresholds=p.get("thresholds", True))
    if module == "km":
        return survival.kaplan_meier(df, p["time"], p["event"], group_var=p.get("group"))
    if module == "cox":
        return survival.cox(df, p["time"], p["event"], p["covariates"])
    if module == "mixed":
        return advanced.mixed_model(df, p["y"], p["fixed"], p["group"],
                                    random_slope=p.get("random_slope"))
    if module == "gee":
        return advanced.gee(df, p["y"], p["predictors"], p["group"],
                            family=p.get("family", "gaussian"), corr=p.get("corr", "exchangeable"))
    if module == "repeated":
        return advanced.repeated_measures(df, p["measures"], between=p.get("between"))
    if module == "propensity":
        return propensity.propensity(df, p["treatment"], p["covariates"], outcome=p.get("outcome"),
                                     method=p.get("method", "match"), caliper=float(p.get("caliper", 0.2)),
                                     treat_level=p.get("treat_level"), n_boot=int(p.get("n_boot", 200)))
    if module == "survey_mean":
        return survey.survey_mean(df, p["var"], p["weight"], strata=p.get("strata"), psu=p.get("psu"))
    if module == "survey_prop":
        return survey.survey_prop(df, p["var"], p["weight"], strata=p.get("strata"), psu=p.get("psu"))
    if module == "survey_reg":
        return survey.survey_reg(df, p["y"], p["xs"], p["weight"], strata=p.get("strata"),
                                 psu=p.get("psu"), family=p.get("family", "gaussian"))
    if module == "meta":
        return meta.meta(df, p["effect_col"], p["se_col"], study_col=p.get("study_col"),
                         measure=p.get("measure", "Effect size"))
    if module == "graph_histogram":
        return graphics.histogram(df, p["variable"], bins=int(p.get("bins", 20)), by=p.get("by"))
    if module == "graph_box":
        return graphics.boxplot(df, p["variable"], by=p.get("by"))
    if module == "graph_bar":
        return graphics.barchart(df, p["variable"], by=p.get("by"), stat=p.get("stat", "count"))
    if module == "graph_scatter":
        return graphics.scatter(df, p["x"], p["y"], by=p.get("by"))

    raise ValueError(f"Unknown analysis module '{module}'")
