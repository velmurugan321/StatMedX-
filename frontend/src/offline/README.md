# Offline mode implementation notes

## Current foundation

`src/offline/engine.ts` provides pure TypeScript descriptive summaries:
- numeric N, missing count, mean, median, sample SD, minimum, maximum, and quartiles
- categorical frequency and percentage tables
- row-oriented dataset summaries

These functions run locally and do not make network requests. They are intentionally isolated from the existing API-backed application until their output is tested against known reference datasets.

## Important limitation

This foundation does **not** make the current StatMedX app or Android APK fully offline. Existing authentication, dataset management, analysis execution, console commands, result history, and exports still depend on the FastAPI backend.

## Integration plan

1. Add local dataset state and persistent device storage, with import/export of supported files.
2. Route supported descriptive analyses to the local engine while retaining clear offline/online capability indicators.
3. Add statistical routines incrementally (categorical tests, continuous tests, correlation, regression, diagnostic accuracy, survival, and meta-analysis), each with reference-value tests and documented assumptions.
4. Remove mandatory remote authentication for offline use and make console/history/export behavior local where supported.
5. Build the Android package in CI and verify startup, import, analysis, save/reopen, and export in airplane mode.

Do not describe the app as fully offline until all required workflows pass airplane-mode testing. Advanced models should remain explicitly unavailable offline until independently validated.
