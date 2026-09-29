import { useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api } from "../api";
import { parseDelimited, parseExcelFile, parseStatFile, saveOfflineDataset } from "../offline";
import { useApp } from "../state";
import { Btn, ErrorNote, inputCls } from "../components/ui";

export default function Dashboard() {
  const { datasets, activeDataset, setActiveDataset, refreshDatasets, user } = useApp();
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [err, setErr] = useState<string | null>(null);
  const [pasteOpen, setPasteOpen] = useState(false);
  const [pasteText, setPasteText] = useState("");
  const [pasteName, setPasteName] = useState("Pasted data");
  const fileRef = useRef<HTMLInputElement>(null);
  const nav = useNavigate();

  const upload = async (f: File) => {
    setErr(null);
    setBusy(true);
    setProgress(0);
    try {
      const name = f.name.replace(/\.[^.]+$/, "");
      const ext = /\.([^.]+)$/.exec(f.name)?.[1]?.toLowerCase() || "";

      // APK/offline-first import: never depend on the server for local files.
      if (ext === "xlsx" || ext === "xls") {
        const ds = await parseExcelFile(f, name, setProgress);
        await saveOfflineDataset(ds);
      } else if (ext === "csv" || ext === "txt" || ext === "tsv") {
        const text = await f.text();
        setProgress(100);
        await saveOfflineDataset(parseDelimited(text, name));
      } else if (ext === "dta" || ext === "sav" || ext === "zsav") {
        throw new Error("Offline import for Stata/SPSS is not available yet. Export the file to CSV or Excel and import it.");
      } else {
        throw new Error("Unsupported file format. Use CSV, TXT, TSV, XLSX or XLS.");
      }

      await refreshDatasets();
      setProgress(100);
    } catch (e: any) {
      setErr(e?.message || "Import failed.");
    } finally {
      setBusy(false);
    }
  };

  const paste = async () => {
    setErr(null);
    setBusy(true);
    try {
      try {
        await api("/api/datasets/paste", {
          method: "POST",
          body: JSON.stringify({ text: pasteText, name: pasteName, sep: "auto" }),
        });
      } catch {
        await saveOfflineDataset(parseDelimited(pasteText, pasteName));
      }
      setPasteOpen(false);
      setPasteText("");
      await refreshDatasets();
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  };

  const del = async (id: number) => {
    if (!confirm("Delete this dataset and its results?")) return;
    await api(`/api/datasets/${id}`, { method: "DELETE" });
    if (activeDataset?.id === id) setActiveDataset(null);
    await refreshDatasets();
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-extrabold tracking-tight text-slate-900">
            Welcome{user?.name ? `, ${user.name}` : ""} 👋
          </h1>
          <p className="mt-1 text-sm text-slate-500">
            Import data, then analyse from the left menu. Every result is saved to the Results window.
          </p>
        </div>
        <div className="flex gap-2">
          <input ref={fileRef} type="file" className="hidden" accept=".csv,.txt,.tsv,.xlsx,.xls,.dta,.sav,.zsav"
                 onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])} />
          <Btn variant="soft" onClick={() => setPasteOpen(true)}>📋 Paste data</Btn>
          <Btn onClick={() => fileRef.current?.click()} disabled={busy}>
            {busy ? `Importing… ${progress}%` : "⬆ Import dataset"}
          </Btn>
        </div>
      </div>

      <ErrorNote msg={err} />
      {busy && (
        <div className="rounded-xl border border-sky-200 bg-sky-50 p-3">
          <div className="mb-1 flex justify-between text-xs font-semibold text-sky-700">
            <span>Reading dataset…</span><span>{progress}%</span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-sky-100">
            <div className="h-full rounded-full bg-sky-500 transition-all" style={{ width: `${progress}%` }} />
          </div>
        </div>
      )}

      <div className="rounded-xl border border-slate-200 bg-white p-4 text-[13px] text-slate-600">
        <span className="font-bold text-slate-800">Supported formats:</span>{" "}
        CSV · TXT/TSV · Excel (.xlsx) · Stata (.dta) · SPSS (.sav) — all supported offline.
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {(Array.isArray(datasets) ? datasets : []).map((d) => (
          <div key={d.id}
               className={`group rounded-2xl border p-4 transition hover:shadow-md ${
                 activeDataset?.id === d.id ? "border-sky-400 bg-sky-50/60 ring-1 ring-sky-200" : "border-slate-200 bg-white"
               }`}>
            <div className="flex items-start justify-between gap-2">
              <button
                className="text-left"
                onClick={() => setActiveDataset(d)}
                title="Set as active dataset"
              >
                <div className="text-[14.5px] font-bold text-slate-800">{d.name}</div>
                <div className="mt-0.5 text-[12px] text-slate-500">
                  {Number(d.n_rows ?? d.rows?.length ?? 0).toLocaleString()} rows × {Number(d.n_cols ?? d.columns?.length ?? 0)} variables · {d.source_format.toUpperCase()}
                </div>
              </button>
              <button className="rounded-md p-1 text-slate-300 opacity-0 transition hover:bg-red-50 hover:text-red-500 group-hover:opacity-100"
                      onClick={() => del(d.id)} title="Delete dataset">
                🗑
              </button>
            </div>
            <p className="mt-2 line-clamp-2 min-h-[32px] text-[12px] text-slate-500">{d.description}</p>
            <div className="mt-3 flex flex-wrap gap-1.5">
              <button className="rounded-md bg-slate-100 px-2 py-1 text-[11.5px] font-semibold text-slate-600 hover:bg-slate-200"
                      onClick={() => nav("/data")}>Open editor</button>
              <button className="rounded-md bg-slate-100 px-2 py-1 text-[11.5px] font-semibold text-slate-600 hover:bg-slate-200"
                      onClick={() => nav("/analysis/descriptive_summarize")}>Summarize</button>
              <button className="rounded-md bg-slate-100 px-2 py-1 text-[11.5px] font-semibold text-slate-600 hover:bg-slate-200"
                      onClick={() => nav("/console")}>Console</button>
            </div>
          </div>
        ))}
        {(!Array.isArray(datasets) || datasets.length === 0) && (
          <div className="col-span-full rounded-2xl border-2 border-dashed border-slate-300 p-10 text-center text-sm text-slate-400">
            No datasets yet — import a CSV/Excel/Stata/SPSS file or paste a table to begin.
          </div>
        )}
      </div>

      {pasteOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4" onClick={() => setPasteOpen(false)}>
          <div className="w-full max-w-2xl rounded-2xl bg-white p-5 shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <h3 className="mb-3 text-base font-bold text-slate-800">Paste data (CSV / TSV / space-separated)</h3>
            <input className={`${inputCls} mb-2`} placeholder="Dataset name" value={pasteName}
                   onChange={(e) => setPasteName(e.target.value)} />
            <textarea className={`${inputCls} mono h-64`} placeholder={"age\tsex\tbp\n54\tM\t142\n…"}
                      value={pasteText} onChange={(e) => setPasteText(e.target.value)} />
            <div className="mt-3 flex justify-end gap-2">
              <Btn variant="ghost" onClick={() => setPasteOpen(false)}>Cancel</Btn>
              <Btn onClick={paste} disabled={busy || !pasteText.trim()}>Create dataset</Btn>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
