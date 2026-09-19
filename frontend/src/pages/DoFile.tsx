import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../api";
import { useApp } from "../state";
import ResultsView from "../components/ResultsView";
import { Btn, ErrorNote, Spinner, inputCls } from "../components/ui";

const SAMPLE = `* StatMedX do-file — cardiovascular example
* runs top to bottom on the active dataset

describe
summarize sbp chol bmi, detail
tabulate group outcome, chi2 fisher

ttest sbp, by(group)
oneway chol group

generate pulse_pressure = sbp - dbp
correlate age chol bmi

regress sbp age bmi smoking
logistic outcome age sbp smoking

stset followup_months, failure(event)
sts graph, by(group)
stcox age sbp smoking
`;

interface LogEntry {
  line: number;
  command: string;
  ok: boolean;
  error?: string;
  result?: any;
}

export default function DoFile() {
  const { activeDataset, bumpData } = useApp();
  const [files, setFiles] = useState<any[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [name, setName] = useState("analysis.do");
  const [content, setContent] = useState(SAMPLE);
  const [stopOnError, setStopOnError] = useState(true);
  const [busy, setBusy] = useState(false);
  const [running, setRunning] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [log, setLog] = useState<any | null>(null);
  const logBottom = useRef<HTMLDivElement>(null);

  const loadFiles = useCallback(async () => {
    try {
      const l = await api<any[]>("/api/dofiles");
      setFiles(l);
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    loadFiles();
  }, [loadFiles]);

  useEffect(() => {
    logBottom.current?.scrollIntoView({ behavior: "smooth" });
  }, [log]);

  const save = async () => {
    setErr(null);
    setBusy(true);
    try {
      if (selectedId) {
        await api(`/api/dofiles/${selectedId}`, {
          method: "PUT",
          body: JSON.stringify({ name, content }),
        });
      } else {
        const r = await api<any>("/api/dofiles", {
          method: "POST",
          body: JSON.stringify({ name, content }),
        });
        setSelectedId(r.id);
      }
      await loadFiles();
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  };

  const openFile = async (id: number) => {
    const f = files.find((x) => x.id === id);
    if (!f) return;
    setSelectedId(f.id);
    setName(f.name);
    setContent(f.content);
    setLog(null);
  };

  const newFile = () => {
    setSelectedId(null);
    setName("analysis.do");
    setContent("");
    setLog(null);
  };

  const del = async (id: number) => {
    if (!confirm("Delete this do-file?")) return;
    await api(`/api/dofiles/${id}`, { method: "DELETE" });
    if (selectedId === id) newFile();
    await loadFiles();
  };

  const run = async () => {
    if (!activeDataset) {
      setErr("Select a dataset in the sidebar first.");
      return;
    }
    setErr(null);
    setRunning(true);
    setLog(null);
    try {
      // save latest content first
      let fid = selectedId;
      if (fid) {
        await api(`/api/dofiles/${fid}`, { method: "PUT", body: JSON.stringify({ name, content }) });
      } else {
        const r = await api<any>("/api/dofiles", { method: "POST", body: JSON.stringify({ name, content }) });
        fid = r.id;
        setSelectedId(fid);
        await loadFiles();
      }
      const res = await api<any>(`/api/dofiles/${fid}/run`, {
        method: "POST",
        body: JSON.stringify({ dataset_id: activeDataset.id, stop_on_error: stopOnError }),
      });
      setLog(res);
      bumpData();
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setRunning(false);
    }
  };

  const downloadLog = () => {
    if (!log) return;
    const lines: string[] = [`StatMedX do-file log — ${log.dofile.name} on ${log.dataset.name}`];
    for (const r of log.results) {
      lines.push("");
      lines.push(`. ${r.command}   [line ${r.line}]`);
      if (!r.ok) lines.push(`error: ${r.error}`);
      else
        for (const b of r.result?.blocks || []) {
          if (b.type === "text") lines.push(b.content.replace(/<[^>]+>/g, ""));
          if (b.type === "table") {
            lines.push(b.columns.map((c: any) => c.label).join("\t"));
            for (const row of b.rows) lines.push(row.map((v: any) => (v ?? "")).join("\t"));
          }
          if (b.type === "figure") lines.push(`[figure: ${b.name}]`);
        }
    }
    const blob = new Blob([lines.join("\n")], { type: "text/plain" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${log.dofile.name.replace(/\.do$/, "")}_log.txt`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const lines = content.split("\n").length;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-extrabold tracking-tight text-slate-900">Do-file editor</h1>
          <p className="text-[13px] text-slate-500">
            Stata-style command scripts — run on <b>{activeDataset?.name || "—"}</b>. Supports <code className="mono rounded bg-slate-100 px-1">* comments</code>, <code className="mono rounded bg-slate-100 px-1">// comments</code> and <code className="mono rounded bg-slate-100 px-1">///</code> line continuation.
          </p>
        </div>
        <div className="flex flex-wrap gap-1.5">
          <Btn variant="ghost" onClick={newFile}>+ New</Btn>
          <Btn variant="soft" onClick={() => setContent(SAMPLE)}>Insert sample</Btn>
          <Btn variant="soft" onClick={save} disabled={busy}>💾 Save</Btn>
          <Btn onClick={run} disabled={running || !activeDataset}>
            {running ? "Running…" : "▶ Run do-file"}
          </Btn>
        </div>
      </div>

      <ErrorNote msg={err} />

      <div className="grid gap-4 lg:grid-cols-[240px_1fr]">
        {/* files list */}
        <div className="h-fit rounded-2xl border border-slate-200 bg-white p-2">
          <div className="px-2 pb-1 pt-1 text-[10.5px] font-bold uppercase tracking-wider text-slate-400">
            Saved do-files
          </div>
          {files.length === 0 && (
            <div className="px-3 py-4 text-[12.5px] text-slate-400">Nothing saved yet.</div>
          )}
          {files.map((f) => (
            <div key={f.id}
                 className={`group flex items-center justify-between rounded-lg px-3 py-2 ${
                   selectedId === f.id ? "bg-sky-50 ring-1 ring-sky-200" : "hover:bg-slate-50"
                 }`}>
              <button className="min-w-0 text-left" onClick={() => openFile(f.id)}>
                <div className="mono truncate text-[12.5px] font-semibold text-slate-700">{f.name}</div>
                <div className="text-[10.5px] text-slate-400">{new Date(f.updated_at).toLocaleString()}</div>
              </button>
              <button className="text-[11px] text-slate-300 opacity-0 hover:text-red-500 group-hover:opacity-100"
                      onClick={() => del(f.id)}>✕</button>
            </div>
          ))}
        </div>

        {/* editor + log */}
        <div className="min-w-0 space-y-3">
          <div className="rounded-2xl border border-slate-200 bg-white p-3">
            <div className="mb-2 flex items-center gap-2">
              <input className={`${inputCls} mono max-w-xs`} value={name} onChange={(e) => setName(e.target.value)} />
              <label className="ml-auto flex items-center gap-1.5 text-[12px] font-medium text-slate-500">
                <input type="checkbox" className="h-3.5 w-3.5 rounded border-slate-300" checked={stopOnError}
                       onChange={(e) => setStopOnError(e.target.checked)} />
                stop on error
              </label>
            </div>
            <div className="flex gap-2">
              <div className="mono select-none pt-2 text-right text-[12.5px] leading-[1.55] text-slate-300">
                {Array.from({ length: Math.min(lines, 24) }, (_, i) => (
                  <div key={i}>{i + 1}</div>
                ))}
                {lines > 24 && <div>…</div>}
              </div>
              <textarea
                className="mono h-96 w-full resize-y rounded-lg border border-slate-200 bg-slate-50 p-2 text-[12.5px] leading-[1.55] text-slate-800 outline-none focus:border-sky-400"
                value={content}
                onChange={(e) => setContent(e.target.value)}
                spellCheck={false}
                placeholder="* one command per line…"
              />
            </div>
          </div>

          {running && <Spinner label="Running do-file…" />}

          {log && (
            <div className="space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="text-[13px] font-semibold text-slate-600">
                  Log: {log.n_commands} commands ·{" "}
                  <span className={log.n_errors ? "text-red-600" : "text-emerald-600"}>
                    {log.n_errors} errors
                  </span>
                  {log.stopped && <span className="text-amber-600"> · stopped early</span>}
                  <span className="text-slate-400"> · dataset now {log.dataset.n_rows}×{log.dataset.n_cols}</span>
                </div>
                <Btn variant="ghost" onClick={downloadLog}>⬇ Download log</Btn>
              </div>
              <div className="rounded-2xl border border-slate-800 bg-slate-900 p-4">
                {log.results.map((r: LogEntry, i: number) => (
                  <div key={i} className="mb-3 last:mb-0">
                    <div className="mono text-[13px] text-emerald-300">
                      <span className="text-slate-500">.</span> {r.command}
                      <span className="ml-2 text-[10.5px] text-slate-500">line {r.line}</span>
                    </div>
                    {r.error && (
                      <div className="mono mt-1 rounded-md bg-red-950/60 px-2 py-1 text-[12px] text-red-300">
                        error: {r.error}
                      </div>
                    )}
                    {r.ok && r.result && (
                      <div className="mt-1.5 rounded-xl bg-white p-3">
                        <ResultsView result={r.result} compact />
                      </div>
                    )}
                  </div>
                ))}
                <div ref={logBottom} />
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
