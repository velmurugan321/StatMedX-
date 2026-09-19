// Configuration for every analysis module — drives the generic analysis form.
export interface FieldDef {
  key: string;
  label: string;
  kind: "var" | "vars" | "select" | "number" | "text" | "checkbox";
  numeric?: boolean;        // only numeric variables
  categorical?: boolean;    // only categorical-ish variables
  multiple?: boolean;
  options?: string[];
  min?: number;
  default?: any;
  help?: string;
  optional?: boolean;
}

export interface ModuleDef {
  id: string;          // API module id
  title: string;
  icon: string;
  group: string;
  blurb: string;
  fields: FieldDef[];
  minVars?: number;
}

export const MODULES: ModuleDef[] = [
  // ---- 03 Descriptive ----
  {
    id: "descriptive_summarize", title: "Summary statistics", icon: "📊", group: "03 · Descriptive",
    blurb: "Mean, SD, SE, median, percentiles, min/max for numeric variables.",
    fields: [
      { key: "variables", label: "Variables", kind: "vars", multiple: true, numeric: true },
      { key: "detail", label: "Detail (skewness, kurtosis, P1–P99, Shapiro-Wilk)", kind: "checkbox", default: false },
    ],
  },
  {
    id: "descriptive_freq", title: "Frequencies", icon: "🧾", group: "03 · Descriptive",
    blurb: "Frequency tables with percentages and cumulative %.",
    fields: [{ key: "variables", label: "Variables", kind: "vars", multiple: true }],
  },
  {
    id: "chi2", title: "Crosstab + Chi-square", icon: "🔀", group: "03 · Descriptive",
    blurb: "Contingency table with Pearson χ², likelihood-ratio χ², optional Fisher exact.",
    fields: [
      { key: "row", label: "Row variable", kind: "var" },
      { key: "col", label: "Column variable", kind: "var" },
      { key: "fisher", label: "Fisher exact (2×2)", kind: "checkbox", default: false },
    ],
  },
  // ---- 04 Tests ----
  {
    id: "ttest_one", title: "One-sample t-test", icon: "🎯", group: "04 · Tests",
    blurb: "Test mean against a hypothesized value.",
    fields: [
      { key: "variable", label: "Variable", kind: "var", numeric: true },
      { key: "testvalue", label: "Hypothesized mean", kind: "number", default: 0 },
    ],
  },
  {
    id: "ttest_two", title: "Two-sample t-test", icon: "⚖️", group: "04 · Tests",
    blurb: "Independent groups, Welch by default; includes Levene, Shapiro-Wilk, Mann-Whitney cross-check.",
    fields: [
      { key: "variable", label: "Outcome variable", kind: "var", numeric: true },
      { key: "group", label: "Group (2 levels)", kind: "var", categorical: true },
      { key: "equalvar", label: "Assume equal variances (pooled t)", kind: "checkbox", default: false },
    ],
  },
  {
    id: "ttest_paired", title: "Paired t-test", icon: "🔁", group: "04 · Tests",
    blurb: "Before/after or matched pairs.",
    fields: [
      { key: "v1", label: "First measurement", kind: "var", numeric: true },
      { key: "v2", label: "Second measurement", kind: "var", numeric: true },
    ],
  },
  {
    id: "mannwhitney", title: "Mann-Whitney U", icon: "🆚", group: "04 · Tests",
    blurb: "Non-parametric two-group comparison (rank-sum).",
    fields: [
      { key: "variable", label: "Outcome variable", kind: "var", numeric: true },
      { key: "group", label: "Group (2 levels)", kind: "var", categorical: true },
    ],
  },
  {
    id: "wilcoxon", title: "Wilcoxon signed-rank", icon: "±", group: "04 · Tests",
    blurb: "Non-parametric paired comparison.",
    fields: [
      { key: "v1", label: "First measurement", kind: "var", numeric: true },
      { key: "v2", label: "Second measurement", kind: "var", numeric: true },
    ],
  },
  {
    id: "anova", title: "One-way ANOVA", icon: "📈", group: "04 · Tests",
    blurb: "3+ group means with η², post-hoc Bonferroni pairs, Kruskal-Wallis cross-check.",
    fields: [
      { key: "variable", label: "Outcome variable", kind: "var", numeric: true },
      { key: "group", label: "Group", kind: "var", categorical: true },
    ],
  },
  {
    id: "kruskal", title: "Kruskal-Wallis H", icon: "📉", group: "04 · Tests",
    blurb: "Non-parametric 3+ group comparison.",
    fields: [
      { key: "variable", label: "Outcome variable", kind: "var", numeric: true },
      { key: "group", label: "Group", kind: "var", categorical: true },
    ],
  },
  // ---- 05 Correlation ----
  {
    id: "corr_pair", title: "Correlation (pair)", icon: "🔗", group: "05 · Correlation",
    blurb: "Pearson r with Fisher-z CI + Spearman ρ + scatter plot.",
    fields: [
      { key: "x", label: "Variable X", kind: "var", numeric: true },
      { key: "y", label: "Variable Y", kind: "var", numeric: true },
    ],
  },
  {
    id: "corr_matrix", title: "Correlation matrix", icon: "▦", group: "05 · Correlation",
    blurb: "Pearson or Spearman matrix with p-values.",
    fields: [
      { key: "variables", label: "Variables", kind: "vars", multiple: true, numeric: true },
      { key: "method", label: "Method", kind: "select", options: ["pearson", "spearman"], default: "pearson" },
    ],
  },
  // ---- 06 Regression ----
  {
    id: "reg_linear", title: "Linear regression", icon: "𝑦", group: "06 · Regression",
    blurb: "OLS with coefficients, R², diagnostics (DW, BP, VIF, residual normality).",
    fields: [
      { key: "y", label: "Dependent variable", kind: "var", numeric: true },
      { key: "xs", label: "Independent variables", kind: "vars", multiple: true, numeric: true },
    ],
  },
  {
    id: "reg_logistic", title: "Logistic regression", icon: "✚", group: "06 · Regression",
    blurb: "Odds ratios, 95% CI, classification table, Hosmer-Lemeshow.",
    fields: [
      { key: "y", label: "Outcome (0/1)", kind: "var", numeric: true },
      { key: "xs", label: "Predictors", kind: "vars", multiple: true, numeric: true },
    ],
  },
  {
    id: "reg_poisson", title: "Poisson regression", icon: "λ", group: "06 · Regression",
    blurb: "IRR with optional robust (sandwich) SE — modified Poisson for binary outcomes.",
    fields: [
      { key: "y", label: "Count/binary outcome", kind: "var", numeric: true },
      { key: "xs", label: "Predictors", kind: "vars", multiple: true, numeric: true },
      { key: "robust", label: "Robust SEs (modified Poisson)", kind: "checkbox", default: false },
    ],
  },
  {
    id: "reg_negbin", title: "Negative binomial", icon: "Γ", group: "06 · Regression",
    blurb: "NB2 for overdispersed counts; LR test vs Poisson.",
    fields: [
      { key: "y", label: "Count outcome", kind: "var", numeric: true },
      { key: "xs", label: "Predictors", kind: "vars", multiple: true, numeric: true },
    ],
  },
  {
    id: "reg_multinomial", title: "Multinomial logistic", icon: "≡", group: "06 · Regression",
    blurb: "3+ outcome categories — relative risk ratios vs base level.",
    fields: [
      { key: "y", label: "Outcome (3+ categories)", kind: "var" },
      { key: "xs", label: "Predictors", kind: "vars", multiple: true, numeric: true },
    ],
  },
  // ---- 07 Diagnostic ----
  {
    id: "diag_2x2", title: "2×2 diagnostic table", icon: "⊞", group: "07 · Diagnostic",
    blurb: "Sensitivity, specificity, PPV, NPV, accuracy, PLR, NLR with Wilson CIs.",
    fields: [
      { key: "tp", label: "True positives (TP)", kind: "number", default: 0 },
      { key: "fp", label: "False positives (FP)", kind: "number", default: 0 },
      { key: "fn", label: "False negatives (FN)", kind: "number", default: 0 },
      { key: "tn", label: "True negatives (TN)", kind: "number", default: 0 },
    ],
  },
  {
    id: "diag_vars", title: "Diagnostic from variables", icon: "⚕", group: "07 · Diagnostic",
    blurb: "Compute the 2×2 from a test variable vs a gold standard.",
    fields: [
      { key: "test_var", label: "Test variable", kind: "var" },
      { key: "gold_var", label: "Gold standard (0/1)", kind: "var", numeric: true },
      { key: "threshold", label: "Test-positive threshold (≥)", kind: "number", optional: true, help: "Leave empty for a 0/1 test variable" },
    ],
  },
  // ---- 08 ROC ----
  {
    id: "roc", title: "ROC curve & AUC", icon: "📡", group: "08 · ROC",
    blurb: "AUC with 95% CI, optimal cut-point, threshold table, curve comparison (2 scores).",
    fields: [
      { key: "y", label: "Outcome (0/1)", kind: "var", numeric: true },
      { key: "score_vars", label: "Test score(s)", kind: "vars", multiple: true, numeric: true },
      { key: "thresholds", label: "Show threshold table", kind: "checkbox", default: true },
    ],
  },
  // ---- 09 Survival ----
  {
    id: "km", title: "Kaplan-Meier", icon: "⏳", group: "09 · Survival",
    blurb: "KM curves with censor marks + log-rank test by group.",
    fields: [
      { key: "time", label: "Time variable", kind: "var", numeric: true },
      { key: "event", label: "Event (1 = event, 0 = censored)", kind: "var", numeric: true },
      { key: "group", label: "Group (optional)", kind: "var", optional: true },
    ],
  },
  {
    id: "cox", title: "Cox regression", icon: "⌛", group: "09 · Survival",
    blurb: "Proportional hazards — hazard ratios with 95% CI, C-index.",
    fields: [
      { key: "time", label: "Time variable", kind: "var", numeric: true },
      { key: "event", label: "Event indicator", kind: "var", numeric: true },
      { key: "covariates", label: "Covariates", kind: "vars", multiple: true, numeric: true },
    ],
  },
  // ---- 10 Advanced ----
  {
    id: "mixed", title: "Mixed model", icon: "🧬", group: "10 · Advanced",
    blurb: "Linear mixed model (random intercept), ICC, REML.",
    fields: [
      { key: "y", label: "Outcome", kind: "var", numeric: true },
      { key: "fixed", label: "Fixed effects", kind: "vars", multiple: true, numeric: true },
      { key: "group", label: "Grouping (random effect)", kind: "var" },
    ],
  },
  {
    id: "gee", title: "GEE", icon: "🧩", group: "10 · Advanced",
    blurb: "Generalized estimating equations with robust (cluster) SEs.",
    fields: [
      { key: "y", label: "Outcome", kind: "var", numeric: true },
      { key: "predictors", label: "Predictors", kind: "vars", multiple: true, numeric: true },
      { key: "group", label: "Cluster variable", kind: "var" },
      { key: "family", label: "Family", kind: "select", options: ["gaussian", "binomial", "poisson"], default: "gaussian" },
      { key: "corr", label: "Working correlation", kind: "select", options: ["exchangeable", "autoregressive", "unstructured", "independence"], default: "exchangeable" },
    ],
  },
  {
    id: "repeated", title: "Repeated measures ANOVA", icon: "↻", group: "10 · Advanced",
    blurb: "Within-subject ANOVA across 2+ measures (wide format) + Bonferroni pairs.",
    fields: [{ key: "measures", label: "Repeated measures (2+)", kind: "vars", multiple: true, numeric: true }],
  },
  {
    id: "propensity", title: "Propensity scores", icon: "⚖", group: "10 · Advanced",
    blurb: "PS matching (1:1, caliper) or IPTW — balance diagnostics, overlap & love plots, treatment effects.",
    fields: [
      { key: "treatment", label: "Treatment variable", kind: "var" },
      { key: "treat_level", label: "Positive level (if not 0/1)", kind: "text", optional: true, help: "e.g. Drug — everything else becomes control" },
      { key: "outcome", label: "Outcome variable", kind: "var", numeric: true, optional: true, help: "Leave out for balance-only analysis" },
      { key: "covariates", label: "Confounders", kind: "vars", multiple: true, numeric: true },
      { key: "method", label: "Method", kind: "select", options: ["match", "iptw"], default: "match" },
      { key: "caliper", label: "Caliper (×SD logit PS)", kind: "number", default: 0.2 },
    ],
  },
  {
    id: "survey_mean", title: "Survey: weighted means", icon: "◍", group: "10 · Advanced",
    blurb: "Design-based means with Taylor-linearized SEs, CI on design df, DEFF.",
    fields: [
      { key: "var", label: "Variable", kind: "var", numeric: true },
      { key: "weight", label: "Weight variable", kind: "var", numeric: true },
      { key: "strata", label: "Strata (optional)", kind: "var", optional: true },
      { key: "psu", label: "PSU / cluster (optional)", kind: "var", optional: true },
    ],
  },
  {
    id: "survey_prop", title: "Survey: proportions", icon: "◍", group: "10 · Advanced",
    blurb: "Weighted category proportions with design-based SEs and CIs.",
    fields: [
      { key: "var", label: "Categorical variable", kind: "var" },
      { key: "weight", label: "Weight variable", kind: "var", numeric: true },
      { key: "strata", label: "Strata (optional)", kind: "var", optional: true },
      { key: "psu", label: "PSU / cluster (optional)", kind: "var", optional: true },
    ],
  },
  {
    id: "survey_reg", title: "Survey: regression", icon: "🕸", group: "10 · Advanced",
    blurb: "Survey-weighted linear or logistic regression with linearized SEs.",
    fields: [
      { key: "y", label: "Dependent variable", kind: "var", numeric: true },
      { key: "xs", label: "Independent variables", kind: "vars", multiple: true, numeric: true },
      { key: "weight", label: "Weight variable", kind: "var", numeric: true },
      { key: "strata", label: "Strata (optional)", kind: "var", optional: true },
      { key: "psu", label: "PSU / cluster (optional)", kind: "var", optional: true },
      { key: "family", label: "Family", kind: "select", options: ["gaussian", "binomial"], default: "gaussian" },
    ],
  },
  // ---- 11 Meta-analysis ----
  {
    id: "meta", title: "Meta-analysis", icon: "🌲", group: "11 · Meta-analysis",
    blurb: "Fixed & random effects, heterogeneity (Q, I², τ²), forest + funnel plots, Egger's test.",
    fields: [
      { key: "effect_col", label: "Effect size column", kind: "var", numeric: true },
      { key: "se_col", label: "Standard error column", kind: "var", numeric: true },
      { key: "study_col", label: "Study name (optional)", kind: "var", optional: true },
    ],
  },
  // ---- 13 Graphics ----
  {
    id: "graph_histogram", title: "Histogram", icon: "▤", group: "13 · Graphics",
    blurb: "Distribution with optional small multiples by group.",
    fields: [
      { key: "variable", label: "Variable", kind: "var", numeric: true },
      { key: "bins", label: "Bins", kind: "number", default: 20 },
      { key: "by", label: "Small multiples by (optional)", kind: "var", optional: true },
    ],
  },
  {
    id: "graph_box", title: "Box plot", icon: "▯", group: "13 · Graphics",
    blurb: "Median, quartiles, outliers — by group optional.",
    fields: [
      { key: "variable", label: "Variable", kind: "var", numeric: true },
      { key: "by", label: "By (optional)", kind: "var", optional: true },
    ],
  },
  {
    id: "graph_bar", title: "Bar chart", icon: "▥", group: "13 · Graphics",
    blurb: "Counts, means or sums by category.",
    fields: [
      { key: "variable", label: "Variable / category", kind: "var" },
      { key: "by", label: "Group by (optional)", kind: "var", optional: true },
      { key: "stat", label: "Statistic", kind: "select", options: ["count", "mean", "sum"], default: "count" },
    ],
  },
  {
    id: "graph_scatter", title: "Scatter plot", icon: "⁘", group: "13 · Graphics",
    blurb: "Two numeric variables with fitted line.",
    fields: [
      { key: "x", label: "X variable", kind: "var", numeric: true },
      { key: "y", label: "Y variable", kind: "var", numeric: true },
      { key: "by", label: "By (optional)", kind: "var", optional: true },
    ],
  },
];

export const GROUPS = Array.from(new Set(MODULES.map((m) => m.group)));
