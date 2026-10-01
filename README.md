# StatMedX

**Web-based statistical analysis platform for medical research** — a Stata/SPSS-style
workspace that runs in the browser: import data (CSV, Excel, TXT/TSV, Stata `.dta`,
SPSS `.sav`), clean and manage it, run the full battery of medical statistics, and
export publication-ready results.

Built with **FastAPI + pandas/SciPy/statsmodels** (analysis engine) and
**React + Vite + Tailwind + Plotly** (workspace UI).

---

## Quick start

```bash
# 1. Backend (Python 3.11+)
cd backend
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt
.venv/bin/uvicorn app.main:app --host 0.0.0.0 --port 8000

# 2. Frontend (Node 18+)
cd ../frontend
npm install
npm run dev          # → http://localhost:5173 (proxies /api → :8000)
```

Open http://localhost:5173 — the **demo workspace** loads automatically with two
sample datasets (`cardio_rct` — 250-patient RCT, `meta_studies` — 12 trials).

## Test the statistical engine

```bash
cd backend && .venv/bin/pytest app/tests -v
```

56 checks including a **real-R cross-validation battery** (actual R 4.6 via
WebR/WASM, run on sleep/mtcars/InsectSprays/airquality) and official Stata
documented-output anchors — see `docs/VALIDATION.md` and `crossval/`.

## Android APK

The Android build is offline-first. It supports local CSV/TXT/TSV and Excel
imports, cell editing, row deletion, local result history, and selected
browser-side analyses. Server-only analyses show
an explicit message while offline. Stata/SPSS imports and the full analysis
catalog need a FastAPI server.

Production web and APK builds use `https://statmedx-api.onrender.com` by default.
Set the repository Actions variable `STATMEDX_API_URL` only to override that
endpoint. Local Vite development uses its `/api` proxy. Pull requests build the
APK and run the backend validation suite.

## Persistent Render storage

The backend stores its SQLite database and uploaded dataset files under
`STATMEDX_STORAGE_DIR`. By default, this is the local `backend/` directory for
development. On Render, set `STATMEDX_STORAGE_DIR=/var/data` and attach a
persistent disk mounted at `/var/data`; both the database and uploaded files
will then survive restarts and deploys. Also set `STATMEDX_ENV=production` and
`STATMEDX_SECRET` to a stable generated secret so sessions remain valid after
restarts.

Render Free web services cannot attach disks. A paid Starter web service is
currently $7/month; a 1 GB persistent disk adds $0.25/month (about $7.25/month
before bandwidth or other usage). A disk-backed service runs one instance and
has a brief interruption during deploys.

## Architecture

```
backend/
  app/
    main.py                  FastAPI app, CORS, seeding
    auth_utils.py            PBKDF2 + JWT auth
    models.py                User / Dataset / Variable / AnalysisRun / CommandHistory
    routers/                 auth, datasets (upload/edit/transform), analysis, results, console
    services/
      dataio.py              CSV/Excel/TXT/TSV/Stata/SPSS readers, DataFrame persistence
      command_parser.py      Stata-style command console (Module 12)
      export_service.py      CSV / Excel / Word / printable-HTML export (Module 14)
      analyses/              one module per statistical domain (Modules 03–13)
    tests/                   validation suite vs scipy/statsmodels references (Module 15)
frontend/
  src/
    modules.ts               config-driven analysis forms
    pages/                   Dashboard, Data editor, Analysis, Console, Results
    components/              Plotly charts, custom forest plot, results renderer
```

## Module status (see `docs/ARCHITECTURE.md`)

| # | Module | Status |
|---|--------|--------|
| 01 | Project foundation (arch, UI system, FE/BE/DB, auth, security) | ✅ |
| 02 | Data management (import, editor, variable view, recode/generate/filter/sort, missing, duplicates) | ✅ |
| 03 | Descriptive statistics | ✅ |
| 04 | Statistical tests (t, MW, Wilcoxon, ANOVA, KW, χ², Fisher) | ✅ |
| 05 | Correlation (Pearson, Spearman, matrix) | ✅ |
| 06 | Regression (OLS, logistic, Poisson ± robust, NB, multinomial + diagnostics) | ✅ |
| 07 | Diagnostic accuracy (2×2, sens/spec/PPV/NPV/PLR/NLR + CIs) | ✅ |
| 08 | ROC (curve, AUC, CI, threshold table, comparison) | ✅ |
| 09 | Survival (KM, log-rank, Cox, HR) | ✅ |
| 10 | Advanced (mixed models, GEE, repeated measures, propensity scores: matching + IPTW, complex survey: means/proportions/regression) | ✅ |
| 11 | Meta-analysis (fixed/random, heterogeneity, forest/funnel, Egger) | ✅ |
| 12 | Command system (console ~50 commands, parser, history, **do-file editor** with `///` continuations, comments, stop-on-error, logs) | ✅ |
| 13 | Graphics (histogram, box, bar, scatter, ROC, KM, forest) | ✅ |
| 14 | Results (window, copy, CSV, Excel, Word, PDF-print) | ✅ |
| 15 | Validation (56 pytest checks) — **R 4.6 cross-validation battery (WebR) + Stata documented anchors**, r×c Fisher, tie-aware exact Mann-Whitney | ✅ |
| 16 | Deployment (Dockerfile, monitoring, backups) | ⏳ |

## Notes

- SQLite by default (`backend/statmedx.db`); swap `DATABASE_URL` for PostgreSQL.
- JWT auth with PBKDF2 password hashing; strict per-user dataset isolation.
- **Never hardcodes a JWT secret**: set `STATMEDX_SECRET` in production (the app
  refuses to start without it); in dev a random ephemeral secret is generated
  per process (sessions reset on restart).
- Data files are pickled DataFrames under `backend/data/` (gitignored).

