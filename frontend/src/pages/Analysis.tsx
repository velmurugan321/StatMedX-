import { useEffect, useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import { api } from "../api";
import { getOfflineDataset, offlineSchema, runOffline } from "../offline";
import { useApp } from "../state";
import { MODULES } from "../modules";
import ResultsView from "../components/ResultsView";
import { Btn, ErrorNote, Labeled, Spinner, inputCls } from "../components/ui";

export default function Analysis() {
  const { moduleId } = useParams();
  const mod = MODULES.find((m) => m.id === moduleId) || MODULES[0];
  const { activeDataset, dataVersion } = useApp();
  const [schema, setSchema] = useState<any | null>(null);
  const [values, setValues] = useState<Record<string, any>>({});
  const [result, setResult] = useState<any | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setValues({});
    setResult(null);
    setErr(null);
  }, [mod.id]);

  useEffect(() => {
    if (!activeDataset) return setSchema(null);
    if (activeDataset.id < 0) {
      getOfflineDataset(activeDataset.id).then((ds) => setSchema(ds ? offlineSchema(ds) : null)).catch(() => setSchema(null));
      return;
    }
    api(`/api/datasets/${activeDataset.id}/schema`).then(setSchema).catch(async () => {
      const ds = await getOfflineDataset(activeDataset.id);
      setSchema(ds ? offlineSchema(ds) : null);
    });
  }, [activeDataset?.id, dataVersion]);

  const defaults = useMemo(() => {
    const d: Record<string, any> = {};
    for (const f of mod.fields) if (f.default !== undefined) d[f.key] = f.default;
    return d;
  }, [mod.id]);

  const setVal = (k: string, v: any) => setValues((cur) => ({ ...cur, [k]: v }));

  const run = async () => {
    if (!activeDataset) return;
    setBusy(true);
    setErr(null);
    try {
      const params: any = {};
      for (const f of mod.fields) {
        const v = values[f.key] ?? defaults[f.key] ?? (f.kind === "checkbox" ? false : undefined);
        if (v !== undefined && v !== "") params[f.key] = v;
      }
      let res: any;
      if (activeDataset.id < 0) {
        const ds = await getOfflineDataset(activeDataset.id);
        if (!ds) throw new Error("Offline dataset not found.");
        const offlineResult = runOffline(ds, mod.id, params);
        res = { id: null, title: offlineResult.title, result: offlineResult };
      } else {
        try {
          res = await api("/api/analysis", {
            method: "POST",
            body: JSON.stringify({ dataset_id: activeDataset.id, module: mod.id, params }),
          });
        } catch (e) {
          const ds = await getOfflineDataset(activeDataset.id);
          if (!ds) throw e;
          const offlineResult = runOffline(ds, mod.id, params);
          res = { id: null, title: offlineResult.title, result: offlineResult };
        }
      }
      setResult(res);
    } catch (e: any) {
      setErr(e.message);
      setResult(null);
    } finally {
      setBusy(false);
    }
  };

  const cols: any[] = schema?.columns || [];
  const numeric = cols.filter((c) => c.numeric);
  const categoricalish = cols.filter((c) => !c.numeric || c.n_unique <= 15);

  const fieldInput = (f: any) => {
    if (f.kind === "vars") {
      const pool = f.numeric ? numeric : f.categorical ? categoricalish : cols;
      const selected: string[] = values[f.key] ?? [];
      return (
        <select
          multiple
          size={Math.min(7, Math.max(4, pool.length))}
          className={`${inputCls} h-auto`}
          value={selected}
          onChange={(e) => setVal(f.key, Array.from(e.target.selectedOptions).map((o) => o.value))}
        >
          {pool.map((c: any) => (
            <option key={c.name} value={c.name}>
              {c.name} {c.numeric ? "" : `(${c.values?.slice(0, 3).join(", ")}${(c.values?.length || 0) > 3 ? "…" : ""})`}
            </option>
          ))}
        </select>
      );
    }
    if (f.kind === "var") {
      const pool = f.numeric ? numeric : f.categorical ? categoricalish : cols;
      return (
        <select className={inputCls} value={values[f.key] ?? ""} onChange={(e) => setVal(f.key, e.target.value)}>
          <option value="">— select —</option>
          {pool.map((c: any) => (
            <option key={c.name} value={c.name}>
              {c.name} {c.numeric ? "" : `(${c.values?.slice(0, 3).join(", ")}${(c.values?.length || 0) > 3 ? "…" : ""})`}
            </option>
          ))}
        </select>
      );
    }
    if (f.kind === "select")
      return (
        <select className={inputCls} value={values[f.key] ?? f.default ?? ""} onChange={(e) => setVal(f.key, e.target.value)}>
          {f.options.map((o: string) => (
            <option key={o} value={o}>{o}</option>
          ))}
        </select>
      );
    if (f.kind === "number")
      return (
        <input type="number" step="any" className={inputCls} value={values[f.key] ?? ""} onChange={(e) => setVal(f.key, e.target.value === "" ? "" : Number(e.target.value))} />
      );
    if (f.kind === "checkbox")
      return (
        <label className="flex items-center gap-2 text-sm text-slate-600">
          <input type="checkbox" className="h-4 w-4 rounded border-slate-300 text-sky-600"
                 checked={values[f.key] ?? f.default ?? false}
                 onChange={(e) => setVal(f.key, e.target.checked)} />
          enable
        </label>
      );
    return <input className={inputCls} value={values[f.key] ?? ""} onChange={(e) => setVal(f.key, e.target.value)} />;
  };

  const ready = mod.fields.every((f) => {
    if (f.optional) return true;
    const v = values[f.key] ?? defaults[f.key];
    if (f.kind === "vars") return Array.isArray(v) && v.length > 0;
    if (f.kind === "checkbox") return true;
    return v !== undefined && v !== "";
  });

  return (
    <div className="space-y-5">
      <div className="flex items-start gap-3">
        <div className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-white text-xl shadow-sm border border-slate-200">{mod.icon}</div>
        <div>
          <h1 className="text-xl font-extrabold tracking-tight text-slate-900">{mod.title}</h1>
          <p className="text-[13px] text-slate-500">{mod.blurb}</p>
        </div>
      </div>

      {!activeDataset && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-700">
          Select a dataset in the sidebar first.
        </div>
      )}

      <div className="grid gap-5 lg:grid-cols-[320px_1fr]">
        {/* form */}
        <div className="h-fit rounded-2xl border border-slate-200 bg-white p-4">
          <div className="mb-3 text-[11px] font-bold uppercase tracking-wider text-slate-400">
            {activeDataset ? activeDataset.name : "no dataset"}
          </div>
          <div className="space-y-3">
            {mod.fields.map((f) => (
              <Labeled key={f.key} label={f.label + (f.optional ? " (optional)" : "")} hint={f.help}>
                {fieldInput(f)}
              </Labeled>
            ))}
          </div>
          <Btn className="mt-4 w-full py-2" onClick={run} disabled={!ready || busy || !activeDataset}>
            {busy ? "Running…" : "▶ Run analysis"}
          </Btn>
        </div>

        {/* results */}
        <div className="min-w-0">
          <ErrorNote msg={err} />
          {busy && <Spinner />}
          {!busy && !result && !err && (
            <div className="rounded-2xl border-2 border-dashed border-slate-200 p-10 text-center text-sm text-slate-400">
              Configure the options and press <b>Run analysis</b>.<br />
              Results are saved automatically to the Results window.
            </div>
          )}
          {result && (
            <div className="space-y-4">
              {result.id && (              <div className="flex flex-wrap gap-1.5">
                <a className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-[12.5px] font-medium text-slate-600 hover:bg-slate-50"
                   href={`/api/results/${result.id}/export?format=excel`} target="_blank">⬇ Excel</a>
                <a className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-[12.5px] font-medium text-slate-600 hover:bg-slate-50"
                   href={`/api/results/${result.id}/export?format=csv`} target="_blank">⬇ CSV</a>
                <a className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-[12.5px] font-medium text-slate-600 hover:bg-slate-50"
                   href={`/api/results/${result.id}/export?format=docx`} target="_blank">⬇ Word</a>
                <a className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-[12.5px] font-medium text-slate-600 hover:bg-slate-50"
                   href={`/api/results/${result.id}/export?format=pdf`} target="_blank">🖨 PDF / Print</a>
              </div>              )}              <ResultsView result={result.result} />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
