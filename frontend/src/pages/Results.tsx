import { useCallback, useEffect, useState } from "react";
import { api } from "../api";
import { useApp } from "../state";
import ResultsView from "../components/ResultsView";
import { Btn, Spinner } from "../components/ui";

export default function Results() {
  const { activeDataset } = useApp();
  const [list, setList] = useState<any[]>([]);
  const [selected, setSelected] = useState<any | null>(null);
  const [loading, setLoading] = useState(true);

  const loadList = useCallback(async () => {
    setLoading(true);
    try {
      const q = activeDataset ? `?dataset_id=${activeDataset.id}` : "";
      const l = await api<any[]>(`/api/results${q}`);
      const safeList = Array.isArray(l) ? l : [];
      setList(safeList);
      if (safeList.length && !selected) openResult(safeList[0].id);
    } finally {
      setLoading(false);
    }
  }, [activeDataset?.id]);

  useEffect(() => {
    loadList();
  }, [loadList]);

  const openResult = async (id: number) => {
    const r = await api<any>(`/api/results/${id}`);
    setSelected(r);
  };

  const copyTables = async () => {
    if (!selected) return;
    const lines: string[] = [];
    for (const b of (Array.isArray(selected?.result?.blocks) ? selected.result.blocks : [])) {
      if (b.type === "table") {
        lines.push(b.name || "");
        const columns = Array.isArray(b.columns) ? b.columns : [];
        const rows = Array.isArray(b.rows) ? b.rows : [];
        lines.push(columns.map((c: any) => c?.label ?? c?.key ?? "").join("\t"));
        for (const r of rows) lines.push((Array.isArray(r) ? r : []).map((v: any) => (v == null ? "" : String(v))).join("\t"));
        lines.push("");
      } else if (b.type === "text") {
        lines.push(b.content.replace(/<[^>]+>/g, ""));
        lines.push("");
      }
    }
    await navigator.clipboard.writeText(lines.join("\n"));
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-xl font-extrabold tracking-tight text-slate-900">Results window</h1>
          <p className="text-[13px] text-slate-500">
            Every saved analysis {activeDataset ? `for ${activeDataset.name}` : "(all datasets)"}.
          </p>
        </div>
        {selected && (
          <div className="flex flex-wrap gap-1.5">
            <Btn variant="ghost" onClick={copyTables}>⧉ Copy</Btn>
            <a className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-[12.5px] font-medium text-slate-600 hover:bg-slate-50"
               href={`/api/results/${selected.id}/export?format=excel`} target="_blank">⬇ Excel</a>
            <a className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-[12.5px] font-medium text-slate-600 hover:bg-slate-50"
               href={`/api/results/${selected.id}/export?format=csv`} target="_blank">⬇ CSV</a>
            <a className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-[12.5px] font-medium text-slate-600 hover:bg-slate-50"
               href={`/api/results/${selected.id}/export?format=docx`} target="_blank">⬇ Word</a>
            <a className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-[12.5px] font-medium text-slate-600 hover:bg-slate-50"
               href={`/api/results/${selected.id}/export?format=pdf`} target="_blank">🖨 PDF</a>
          </div>
        )}
      </div>

      <div className="grid gap-4 lg:grid-cols-[300px_1fr]">
        <div className="h-fit space-y-1.5 rounded-2xl border border-slate-200 bg-white p-2">
          {loading && <Spinner label="Loading results…" />}
          {!loading && list.length === 0 && (
            <div className="p-6 text-center text-[13px] text-slate-400">No saved results yet — run an analysis.</div>
          )}
          {(Array.isArray(list) ? list : []).map((r) => (
            <button key={r.id}
                    className={`w-full rounded-lg px-3 py-2 text-left transition ${
                      selected?.id === r.id ? "bg-sky-50 ring-1 ring-sky-200" : "hover:bg-slate-50"
                    }`}
                    onClick={() => openResult(r.id)}>
              <div className="truncate text-[13px] font-semibold text-slate-700">{r.title}</div>
              <div className="text-[11px] text-slate-400">
                {r.module} · {new Date(r.created_at).toLocaleString()}
              </div>
            </button>
          ))}
        </div>
        <div className="min-w-0">
          {selected ? (
            <ResultsView result={selected.result} />
          ) : (
            !loading && (
              <div className="rounded-2xl border-2 border-dashed border-slate-200 p-12 text-center text-sm text-slate-400">
                Select a saved result to view it.
              </div>
            )
          )}
        </div>
      </div>
    </div>
  );
}
