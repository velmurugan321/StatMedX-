import { useMemo, useState } from "react";
import { summarizeCategorical, summarizeNumeric, type DataRow } from "../offline/engine";

type LocalDataset = { id: string; name: string; columns: string[]; rows: DataRow[]; savedAt: string };
const STORAGE_KEY = "statmedx_offline_datasets_v1";

function parseCsv(source: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [], cell = "", quoted = false;
  for (let i = 0; i < source.length; i++) {
    const ch = source[i];
    if (quoted) {
      if (ch === '"' && source[i + 1] === '"') { cell += '"'; i++; }
      else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"' && cell === "") quoted = true;
    else if (ch === ",") { row.push(cell); cell = ""; }
    else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && source[i + 1] === "\n") i++;
      row.push(cell); cell = "";
      if (row.some((v) => v.trim() !== "")) rows.push(row);
      row = [];
    } else cell += ch;
  }
  row.push(cell);
  if (row.some((v) => v.trim() !== "")) rows.push(row);
  return rows;
}

function readSaved(): LocalDataset[] {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]"); }
  catch { return []; }
}

export default function OfflineData() {
  const [datasets, setDatasets] = useState<LocalDataset[]>(readSaved);
  const [active, setActive] = useState<string>(datasets[0]?.id || "");
  const [error, setError] = useState("");
  const [frequencyVar, setFrequencyVar] = useState("");
  const current = datasets.find((d) => d.id === active);
  const save = (next: LocalDataset[]) => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      setDatasets(next);
      setError("");
    } catch {
      setError("Device storage is full or unavailable. Try a smaller CSV file.");
    }
  };
  const importFile = async (file?: File) => {
    if (!file) return;
    setError("");
    if (!/\.(csv|txt|tsv)$/i.test(file.name)) {
      setError("This offline importer currently supports CSV, TXT and TSV files. Excel, Stata and SPSS import still need backend support.");
      return;
    }
    try {
      const text = await file.text();
      const delimiter = /\.tsv$/i.test(file.name) ? "\t" : text.split(/\r?\n/, 1)[0].includes("\t") ? "\t" : ",";
      const matrix = delimiter === "," ? parseCsv(text) : text.split(/\r?\n/).filter((line) => line.trim()).map((line) => line.split(delimiter));
      if (matrix.length < 2) throw new Error("The file must contain a header and at least one data row.");
      const columns = matrix[0].map((v, i) => v.trim() || `variable_${i + 1}`);
      if (new Set(columns).size !== columns.length) throw new Error("Column names must be unique.");
      const rows = matrix.slice(1).map((cells) => Object.fromEntries(columns.map((c, i) => {
        const value = (cells[i] ?? "").trim();
        if (!value) return [c, null];
        const numeric = Number(value);
        return [c, Number.isFinite(numeric) ? numeric : value];
      })));
      const item: LocalDataset = { id: `local-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, name: file.name.replace(/\.[^.]+$/, ""), columns, rows, savedAt: new Date().toISOString() };
      const next = [item, ...datasets];
      save(next);
      setActive(item.id);
    } catch (e) { setError(e instanceof Error ? e.message : "Unable to read this file."); }
  };
  const remove = () => {
    if (!current || !window.confirm(`Delete local dataset "${current.name}" from this device?`)) return;
    const next = datasets.filter((d) => d.id !== current.id);
    save(next);
    setActive(next[0]?.id || "");
  };
  const summaries = useMemo(() => current ? current.columns.map((name) => {
    const values = current.rows.map((r) => r[name]);
    const numeric = summarizeNumeric(values);
    const categorical = summarizeCategorical(values);
    const isNumeric = numeric.n > 0 && categorical.levels.length > 0 && numeric.n + numeric.missing === values.length;
    return { name, isNumeric, numeric, categorical };
  }) : [], [current]);
  const frequency = useMemo(() => {
    if (!current || !frequencyVar) return [];
    const counts = new Map<string, number>();
    let missing = 0;
    for (const row of current.rows) {
      const raw = row[frequencyVar];
      if (raw == null || String(raw).trim() === "") { missing++; continue; }
      const key = String(raw).trim();
      counts.set(key, (counts.get(key) || 0) + 1);
    }
    const n = current.rows.length - missing;
    return Array.from(counts, ([value, count]) => ({ value, count, percent: n ? count * 100 / n : 0 }))
      .sort((a, b) => b.count - a.count || a.value.localeCompare(b.value));
  }, [current, frequencyVar]);
  const exportCsv = () => {
    if (!current) return;
    const quote = (v: unknown) => {
      const s = v == null ? "" : String(v);
      return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const csv = [current.columns, ...current.rows.map((r) => current.columns.map((c) => r[c]))].map((r) => r.map(quote).join(",")).join("\r\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const a = document.createElement("a"); a.href = url; a.download = `${current.name}.csv`; a.click(); URL.revokeObjectURL(url);
  };
  return <div className="space-y-5">
    <div><h1 className="text-xl font-extrabold text-slate-900">Offline data workspace</h1><p className="mt-1 text-sm text-slate-500">Import and keep CSV/TXT/TSV datasets on this device. No server request is made by this page.</p></div>
    <div className="rounded-xl border border-sky-200 bg-sky-50 p-4 text-sm text-sky-900">Offline foundation: local import, device storage and descriptive summaries. This is separate from the existing backend-powered analysis modules.</div>
    <div className="flex flex-wrap items-center gap-3"><label className="cursor-pointer rounded-lg bg-sky-600 px-4 py-2 text-sm font-semibold text-white">Import CSV / TXT / TSV<input type="file" accept=".csv,.txt,.tsv,text/csv,text/plain" className="hidden" onChange={(e) => { void importFile(e.target.files?.[0]); e.currentTarget.value = ""; }} /></label>
    <select className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm" value={active} onChange={(e) => setActive(e.target.value)}><option value="">Choose local dataset</option>{datasets.map((d) => <option key={d.id} value={d.id}>{d.name} ({d.rows.length} rows)</option>)}</select>
    {current && <><button className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm" onClick={exportCsv}>Export CSV</button><button className="rounded-lg border border-red-200 px-3 py-2 text-sm text-red-600" onClick={remove}>Delete</button></>}</div>
    {error && <div role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</div>}
    {current ? <><div className="text-sm font-semibold text-slate-700">{current.name}: {current.rows.length.toLocaleString()} rows × {current.columns.length} variables <span className="font-normal text-slate-400">· saved on this device</span></div>
      <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white"><table className="min-w-full text-left text-sm"><thead className="bg-slate-50"><tr><th className="p-3">Variable</th><th className="p-3">Type</th><th className="p-3">N</th><th className="p-3">Missing</th><th className="p-3">Mean / Levels</th><th className="p-3">SD / %</th><th className="p-3">Median / Min–Max</th></tr></thead><tbody>{summaries.map((s) => <tr key={s.name} className="border-t border-slate-100"><td className="p-3 font-medium">{s.name}</td><td className="p-3">{s.isNumeric ? "Numeric" : "Categorical"}</td><td className="p-3">{s.isNumeric ? s.numeric.n : s.categorical.n}</td><td className="p-3">{s.isNumeric ? s.numeric.missing : s.categorical.missing}</td><td className="p-3">{s.isNumeric ? s.numeric.mean?.toFixed(2) : s.categorical.levels.slice(0, 3).map((l) => l.value).join(", ")}</td><td className="p-3">{s.isNumeric ? s.numeric.sd?.toFixed(2) ?? "—" : s.categorical.levels.slice(0, 2).map((l) => `${l.percent.toFixed(1)}%`).join(", ")}</td><td className="p-3">{s.isNumeric ? `${s.numeric.median?.toFixed(2)} / ${s.numeric.min}–${s.numeric.max}` : s.categorical.levels.slice(0, 2).map((l) => `${l.value}: ${l.n}`).join("; ")}</td></tr>)}</tbody></table></div>
      <section className="space-y-3 rounded-xl border border-slate-200 bg-white p-4">
        <div><h2 className="text-sm font-bold text-slate-800">Offline frequency table</h2><p className="text-xs text-slate-500">Select a variable to calculate counts and percentages locally.</p></div>
        <select aria-label="Frequency variable" className="w-full max-w-sm rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm" value={frequencyVar} onChange={(e) => setFrequencyVar(e.target.value)}>
          <option value="">Select variable</option>{current.columns.map((name) => <option key={name} value={name}>{name}</option>)}
        </select>
        {frequencyVar && <div className="overflow-x-auto"><table className="min-w-full text-left text-sm"><thead className="bg-slate-50"><tr><th className="p-2">Value</th><th className="p-2">Frequency</th><th className="p-2">Percent</th></tr></thead><tbody>
          {frequency.map((item) => <tr key={item.value} className="border-t border-slate-100"><td className="p-2">{item.value}</td><td className="p-2">{item.count}</td><td className="p-2">{item.percent.toFixed(1)}%</td></tr>)}
          <tr className="border-t border-slate-200 font-semibold"><td className="p-2">Missing</td><td className="p-2">{current.rows.length - frequency.reduce((sum, item) => sum + item.count, 0)}</td><td className="p-2">—</td></tr>
          <tr className="border-t border-slate-200 font-semibold"><td className="p-2">Valid total</td><td className="p-2">{frequency.reduce((sum, item) => sum + item.count, 0)}</td><td className="p-2">100%</td></tr>
        </tbody></table></div>}
      </section>
      <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white"><table className="min-w-full text-left text-xs"><thead className="bg-slate-50"><tr>{current.columns.slice(0, 8).map((c) => <th className="p-2" key={c}>{c}</th>)}</tr></thead><tbody>{current.rows.slice(0, 20).map((r, i) => <tr key={i} className="border-t border-slate-100">{current.columns.slice(0, 8).map((c) => <td className="p-2" key={c}>{r[c] == null ? "" : String(r[c])}</td>)}</tr>)}</tbody></table></div><p className="text-xs text-slate-400">Preview shows up to 20 rows and 8 columns. Stored in this browser/app's local storage; clearing app data may erase it.</p>
    </> : <div className="rounded-xl border-2 border-dashed border-slate-300 p-10 text-center text-sm text-slate-400">{datasets.length ? "Select a local dataset to view its summary." : "No local datasets yet. Import a CSV, TXT or TSV file to begin."}</div>}
  </div>;
}
