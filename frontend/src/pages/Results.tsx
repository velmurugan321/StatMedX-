import { useCallback, useEffect, useState } from "react";
import { api, downloadFile } from "../api";
import { useApp } from "../state";
import ResultsView from "../components/ResultsView";
import { Btn, Spinner } from "../components/ui";
import { getOfflineResult, listOfflineResults } from "../offline";
import * as XLSX from "xlsx";

export default function Results() {
  const { activeDataset } = useApp();
  const [list, setList] = useState<any[]>([]);
  const [selected, setSelected] = useState<any | null>(null);
  const [loading, setLoading] = useState(true);

  const loadList = useCallback(async () => {
    setLoading(true);
    try {
      if (activeDataset?.id < 0) {
        const local = await listOfflineResults(activeDataset.id);
        setList(local);
        setSelected(local[0] ?? null);
        return;
      }
      const q = activeDataset ? `?dataset_id=${activeDataset.id}` : "";
      const l = await api<any[]>(`/api/results${q}`);
      const safeList = Array.isArray(l) ? l : [];
      setList(safeList);
      if (!safeList.length) setSelected(null);
      else if (!safeList.some((item: any) => item.id === selected?.id)) await openResult(safeList[0].id);
    } catch {
      const local = await listOfflineResults(activeDataset?.id);
      setList(local);
      setSelected(local[0] ?? null);
    } finally {
      setLoading(false);
    }
  }, [activeDataset?.id, selected?.id]);

  useEffect(() => {
    loadList();
  }, [loadList]);

  const openResult = async (id: number) => {
    if (id < 0) {
      setSelected(await getOfflineResult(id));
      return;
    }
    const r = await api<any>(`/api/results/${id}`);
    setSelected(r);
  };

  const exportOffline = (format: "csv" | "excel") => {
    if (!selected || selected.id >= 0) return;
    const rows: any[][] = [];
    for (const b of (Array.isArray(selected.result?.blocks) ? selected.result.blocks : [])) {
      if (b.type === "table") {
        rows.push([b.name || "Results"]);
        rows.push((Array.isArray(b.columns) ? b.columns : []).map((c: any) => c?.label ?? c?.key ?? ""));
        rows.push(...(Array.isArray(b.rows) ? b.rows : [])); rows.push([]);
      } else if (b.type === "text") rows.push([String(b.content || "").replace(/<[^>]+>/g, "")]);
    }
    let blob: Blob;
    if (format === "excel") {
      const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows.length ? rows : [[selected.title]]), "Results");
      blob = new Blob([XLSX.write(wb, { bookType: "xlsx", type: "array" })], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
    } else {
      const esc = (v: any) => { const s = v == null ? "" : String(v); return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
      blob = new Blob(["\uFEFF", rows.map(r => r.map(esc).join(",")).join("\r\n")], { type: "text/csv;charset=utf-8" });
    }
    const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = `${selected.module}-results.${format === "excel" ? "xlsx" : "csv"}`; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
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
            {selected.id < 0 ? <>
              <Btn variant="ghost" onClick={() => exportOffline("excel")}>⬇ Excel</Btn>
              <Btn variant="ghost" onClick={() => exportOffline("csv")}>⬇ CSV</Btn>
              <Btn variant="ghost" onClick={() => window.print()}>🖨 Print / PDF</Btn>
            </> : <>
              <Btn variant="ghost" onClick={() => downloadFile(`/api/results/${selected.id}/export?format=excel`, `${selected.module}-results.xlsx`)}>⬇ Excel</Btn>
              <Btn variant="ghost" onClick={() => downloadFile(`/api/results/${selected.id}/export?format=csv`, `${selected.module}-results.csv`)}>⬇ CSV</Btn>
              <Btn variant="ghost" onClick={() => downloadFile(`/api/results/${selected.id}/export?format=docx`, `${selected.module}-results.docx`)}>⬇ Word</Btn>
              <Btn variant="ghost" onClick={() => downloadFile(`/api/results/${selected.id}/export?format=pdf`, `${selected.module}-results.pdf`)}>🖨 PDF</Btn>
            </>}
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

