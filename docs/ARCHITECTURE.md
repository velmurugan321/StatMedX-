# StatMedX — Architecture & Roadmap

Sixteen-module plan; status tracked below. ✅ = working in this build ·
🔶 = first wave done, more planned · ⏳ = not started.

---

## 01. PROJECT FOUNDATION — ✅
- **Product architecture**: FastAPI (analysis engine) + React SPA (workspace). The browser talks only to the frontend origin; `/api` is proxied server-side.
- **UI/UX system**: Tailwind design system — slate/sky palette, sidebar module navigation, Stata-style dark console, consistent result cards.
- **Frontend**: React 18 + Vite + TypeScript, config-driven analysis forms (`src/modules.ts`), Plotly charting.
- **Backend**: FastAPI + pandas/SciPy/statsmodels; result model = `{title, blocks:[text|table|figure|code]}` shared by every module.
- **Database layer**: SQLAlchemy + SQLite (dev) / PostgreSQL-ready (swap `DATABASE_URL`). Tables: users, datasets, variables (Variable View metadata), analysis_runs, command_history.
- **Authentication**: JWT bearer tokens (72 h), PBKDF2-SHA256 (200k iterations) password hashing, per-user dataset isolation, demo workspace auto-login.
- **Security**: parameterised ORM queries, dtype-validated cell edits, file type/size allowlist on upload, CORS config point for production hardening.

## 02. DATA MANAGEMENT — ✅
- Import: **CSV, TXT/TSV, Excel (.xlsx/.xls), Stata (.dta), SPSS (.sav)** + paste-any-table.
- **Data Editor**: paginated editable grid (double-click cell), add/delete variables & cases.
- **Variable View**: name, label, type, categorical flag, missing codes, value labels.
- Data cleaning: **Generate** (expressions), **Recode** (ranges/values → new or in place), **Filter**, **Sort**, rename, delete.
- **Missing data**: NA parsing on import, missing-code conversion, mean/median/zero imputation, listwise drop, `misstable`.
- **Duplicate detection**: report + drop.

## 03. DESCRIPTIVE STATISTICS — ✅
Mean, SD, SE, median, IQR (P25/P75), min/max, P1–P99, skewness, kurtosis, Shapiro-Wilk,
frequency tables with cumulative %, crosstabs with row %.

## 04. STATISTICAL TESTS — ✅
- One-sample / two-sample (Welch + pooled) / **paired t-test** with CIs and Cohen's d
- **Mann-Whitney U** (rank-biserial effect size) · **Wilcoxon signed-rank**
- **One-way ANOVA** (η², post-hoc Bonferroni) · **Kruskal-Wallis H** (ε²)
- **Chi-square** (Pearson + likelihood-ratio, expected-count warnings) · **Fisher exact**
- Automatic cross-checks: Levene, Shapiro-Wilk, non-parametric alternative alongside parametric tests.

## 05. CORRELATION — ✅
Pearson (Fisher-z CI), Spearman ρ, full matrix with pairwise p-values, scatter preview.

## 06. REGRESSION — ✅
- **Linear (OLS)**: coefficients, R²/adj-R², F, RMSE + diagnostics: Durbin-Watson, Breusch-Pagan, residual Shapiro-Wilk, Cook's D, VIF.
- **Logistic**: ORs with CIs, pseudo-R², LR test, classification table, Hosmer-Lemeshow.
- **Poisson**: IRRs + dispersion check; **Robust Poisson** (sandwich SEs — modified Poisson for binary outcomes).
- **Negative binomial (NB2)** with α and LR test vs Poisson.
- **Multinomial logistic**: relative-risk ratios vs base category.

## 07. DIAGNOSTIC — ✅
2×2 table from counts or from variables (threshold or positive level) →
**Sensitivity, Specificity, PPV, NPV, Accuracy, PLR, NLR** — all with **95% Wilson CIs**, prevalence, χ²/Fisher.

## 08. ROC — ✅
Curve(s), **AUC** with Hanley-McNeil SE & 95% CI, **optimal cut-point** (Youden),
**threshold table** (TP/FP/FN/TN, sens, spec, PPV, NPV, Youden J, distance), bootstrap **comparison of two ROC curves**.

## 09. SURVIVAL — ✅
**Kaplan-Meier** curves (censor marks, median survival) by group, **log-rank test**
(multigroup, pooled O−E), **Cox regression** (Efron ties) → HRs with CIs, LR test, C-index.

## 10. ADVANCED ANALYSIS — 🔶
- ✅ Linear **mixed models** (random intercept/slope, ICC), **GEE** (gaussian/binomial/poisson × exchangeable/AR1/unstructured), **repeated-measures ANOVA** (+GG ε, Bonferroni pairs).
- ⏳ Propensity scores (matching/IPTW), complex survey analysis.

## 11. META-ANALYSIS — ✅
Inverse-variance **fixed effects** + **DerSimonian-Laird random effects**, **Q / I² / H / τ² heterogeneity**,
custom **forest plot**, **funnel plot**, **Egger's test** for publication bias.

## 12. COMMAND SYSTEM — 🔶
- ✅ **Command console** with ~40 Stata-style commands (`summarize, tabulate, ttest, ranksum, oneway, kwallis, correlate, regress, logistic, poisson, nbreg, mlogit, roc, stset/sts/stcox, generate, recode, keep/drop if, sort, duplicates, misstable, histogram, graph box/bar, scatter, help`), options parsing (`by()`, `detail`, `chi2`, `robust`, `failure()`, `spearman`…), ↑/↓ **history**, DB-backed command history, dataset-mutating commands.
- ⏳ Do-file editor (multi-line scripts), re-run across datasets.

## 13. GRAPHICS — ✅
Histogram (+small multiples), box plot, bar chart (count/mean/sum), scatter (+fit line) —
plus embedded **ROC, Kaplan-Meier, forest, funnel** charts inside their analyses. All Plotly-rendered.

## 14. RESULTS — ✅
Results window (saved runs, filter by dataset), tables + charts rendering, **copy as TSV**,
**export CSV / Excel / Word (.docx)**, **printable HTML → PDF** per result; dataset-level CSV/Excel export from the editor.

## 15. VALIDATION — 🔶
- ✅ 20-check pytest suite: hand-computed references (KM estimator, 2×2 measures, perfect-AUC) + scipy/statsmodels cross-validation (t-tests, ANOVA, χ², OLS, logistic OR), reproducibility (numerical tolerance) tests. `cd backend && .venv/bin/pytest app/tests -v`
- ⏳ Known public datasets battery, Stata & R comparison fixtures, CI regression tests.

## 16. DEPLOYMENT — ⏳
Planned: Dockerfile + compose (api + web + postgres), error monitoring (Sentry), backups, production security hardening (strict CORS, HTTPS, rate limiting, non-ephemeral secrets).
