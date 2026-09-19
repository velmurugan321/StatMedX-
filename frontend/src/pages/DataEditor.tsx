import { useCallback, useEffect, useState } from "react";
import { api } from "../api";
import { useApp } from "../state";
import { Btn, ErrorNote, Labeled, Modal, Spinner, inputCls } from "../components/ui";

interface TransformDialog {
  op: string;
  title: string;
  body: React.ReactNode;
  payload: Record<string, any>;
}

export default function DataEditor() {
  const { activeDataset, dataVersion, bumpData, refreshDatasets } = useApp();
  const [data, setData] = useState<any | null>(null);
  const [page, setPage] = useState(1);
  const [editing, setEditing] = useState<{ r: number; c: string; v: string } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [dlg, setDlg] = useState<TransformDialog | null>(null);
  const [schema, setSchema] = useState<any | null>(null);
  const [view, setView] = useState<"data" | "variables">("data");

  const pageSize = 50;
  const dsid = activeDataset?.id;

  const load = useCallback(async () => {
    if (!dsid) return;
    setBusy(true);
    try {
      const d = await api(`/api/datasets/${dsid}/data?page=${page}&size=${pageSize}`);
      setData(d);
      setSchema(await api(`/api/datasets/${dsid}/schema`));
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  }, [dsid, page, dataVersion]);

  useEffect(() => {
    load();
  }, [load]);

  if (!dsid)
    return (
      <div className="rounded-2xl border-2 border-dashed border-slate-300 p-12 text-center text-sm text-slate-400">
        Select a dataset in the sidebar (or import one on the Dashboard) to open the data editor.
      </div>
    );

  const runTransform = async (op: string, params: any) => {
    setErr(null);
    setMsg(null);
    setBusy(true);
    try {
      const res = await api(`/api/datasets/${dsid}/transform`, {
        method: "POST",
        body: JSON.stringify({ op, params }),
      });
      setMsg(res.message || "Done");
      setDlg(null);
      await load();
      bumpData();
      refreshDatasets();
      setPage(1);
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  };

  const saveCell = async () => {
    if (!editing) return;
    try {
      await api(`/api/datasets/${dsid}/cell`, {
        method: "POST",
        body: JSON.stringify({ row: editing.r, column: editing.c, value: editing.v === "" ? null : editing.v }),
      });
      setEditing(null);
      await load();
    } catch (e: any) {
      setErr(e.message);
      setEditing(null);
    }
  };

  const totalPages = data ? Math.max(1, Math.ceil(data.total / pageSize)) : 1;
  const cols = schema?.columns || [];

  // ---- dialogs ----
  const varNames = cols.map((c: any) => c.name);
  const numNames = cols.filter((c: any) => c.numeric).map((c: any) => c.name);

  const openGenerate = () => {
    let name = "new_var", expr = "";
    setDlg({
      op: "generate",
      title: "Generate variable (expression)",
      payload: () => ({ name, expression: expr }),
      body: (
        <div className="space-y-3">
          <Labeled label="New variable name">
            <input className={inputCls} defaultValue={name} onChange={(e) => (name = e.target.value)} />
          </Labeled>
          <Labeled label="Expression" hint="e.g. sbp - dbp   ·   (chol - 200) / 10   ·   (age > 60) * 1">
            <input className={`${inputCls} mono`} placeholder="sbp - dbp" onChange={(e) => (expr = e.target.value)} />
          </Labeled>
          <div className="text-[11px] text-slate-400">Available variables: {numNames.join(", ")}</div>
        </div>
      ),
    } as any);
  };

  const openRecode = () => {
    let variable = varNames[0], genAs = "", rules: any[] = [{ old: "", new: "" }];
    const upd = () => setDlg((d) => ({ ...d! }));
    setDlg({
      op: "recode",
      title: "Recode values",
      payload: () => ({ variable, rules, generate_as: genAs || undefined }),
      body: (
        <div className="space-y-3">
          <Labeled label="Variable">
            <select className={inputCls} defaultValue={variable}
                    onChange={(e) => { variable = e.target.value; upd(); }}>
              {varNames.map((v: string) => <option key={v}>{v}</option>)}
            </select>
          </Labeled>
          {rules.map((r, i) => (
            <div key={i} className="flex items-center gap-2">
              <input className={inputCls} placeholder="old (e.g. 1 or 40/60)" defaultValue={r.old}
                     onChange={(e) => { r.old = e.target.value; }} />
              <span className="text-slate-400">→</span>
              <input className={inputCls} placeholder="new value" defaultValue={r.new}
                     onChange={(e) => { r.new = e.target.value; }} />
              <button className="text-slate-400 hover:text-red-500"
                      onClick={() => { rules.splice(i, 1); upd(); }}>✕</button>
            </div>
          ))}
          <Btn variant="soft" onClick={() => { rules.push({ old: "", new: "" }); upd(); }}>+ add rule</Btn>
          <Labeled label="Generate as new variable (optional)" hint="Leave empty to recode in place. Use ranges like 40/60, min/50, 50/max">
            <input className={inputCls} onChange={(e) => (genAs = e.target.value)} />
          </Labeled>
        </div>
      ),
    } as any);
  };

  const openFilter = () => {
    let condition = "";
    setDlg({
      op: "filter",
      title: "Filter cases (keeps matching rows)",
      payload: () => ({ condition }),
      body: (
        <div className="space-y-3">
          <Labeled label="Condition" hint={'e.g. age > 60 · group == "Drug" · outcome == 1 & sbp >= 140. Note: this trims the dataset.'}>
            <input className={`${inputCls} mono`} placeholder="age > 60" onChange={(e) => (condition = e.target.value)} />
          </Labeled>
        </div>
      ),
    } as any);
  };

  const openSort = () => {
    let variables: string[] = [];
    setDlg({
      op: "sort",
      title: "Sort cases",
      payload: () => ({ variables, ascending: true }),
      body: (
        <Labeled label="Sort by (hold Ctrl for multiple)">
          <select className={inputCls} multiple size={5} defaultValue={[]}
                  onChange={(e) => (variables = Array.from(e.target.selectedOptions).map((o) => o.value))}>
            {varNames.map((v: string) => <option key={v}>{v}</option>)}
          </select>
        </Labeled>
      ),
    } as any);
  };

  const openMissing = () => {
    let name = varNames[0], method = "mean";
    setDlg({
      op: "impute_missing",
      title: "Handle missing data",
      payload: () => ({ name, method }),
      body: (
        <div className="space-y-3">
          <Labeled label="Variable">
            <select className={inputCls} onChange={(e) => (name = e.target.value)} defaultValue={name}>
              {numNames.map((v: string) => <option key={v}>{v}</option>)}
            </select>
          </Labeled>
          <Labeled label="Impute with">
            <select className={inputCls} onChange={(e) => (method = e.target.value)} defaultValue="mean">
              <option value="mean">Mean</option>
              <option value="median">Median</option>
              <option value="zero">Zero</option>
            </select>
          </Labeled>
          <div className="text-[11px] text-slate-400">
            Missing summary: {cols.map((c: any) => `${c.name}: ${c.n_unique === undefined ? "?" : ""}`).slice(0, 0)}
            Use the console command <code className="mono">misstable summarize</code> for a full report.
          </div>
        </div>
      ),
    } as any);
  };

  const openDuplicates = async () => {
    setBusy(true);
    try {
      const res = await api(`/api/datasets/${dsid}/transform`, {
        method: "POST",
        body: JSON.stringify({ op: "dedupe", params: { mode: "report" } }),
      });
      setDlg({
        op: "dedupe",
        title: "Duplicate detection",
        payload: () => ({}),
        body: (
          <div>
            <div className="mb-2 text-sm text-slate-600">{res.message}</div>
            <div className="max-h-52 overflow-auto rounded-lg border border-slate-200">
              <table className="smx-table">
                <thead><tr>{(res.duplicates[0] ? Object.keys(res.duplicates[0]) : ["—"]).map((k: string) => <th key={k}>{k}</th>)}</tr></thead>
                <tbody>
                  {res.duplicates.map((r: any, i: number) => (
                    <tr key={i}>{Object.values(r).map((v: any, j: number) => <td key={j}>{v === null ? "" : String(v)}</td>)}</tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="mt-3 flex justify-end gap-2">
              <Btn variant="danger" onClick={() => runTransform("dedupe", {})}>Remove duplicates</Btn>
            </div>
          </div>
        ),
      } as any);
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-extrabold tracking-tight text-slate-900">Data editor</h1>
          <p className="text-[13px] text-slate-500">
            {schema?.name} — {schema?.n_rows?.toLocaleString()} cases × {schema?.n_cols} variables
          </p>
        </div>
        <div className="flex rounded-lg bg-slate-200/70 p-1 text-[12.5px] font-semibold">
          {(["data", "variables"] as const).map((v) => (
            <button key={v} className={`rounded-md px-3 py-1 capitalize ${view === v ? "bg-white shadow text-slate-800" : "text-slate-500"}`}
                    onClick={() => setView(v)}>
              {v === "data" ? "Data view" : "Variable view"}
            </button>
          ))}
        </div>
      </div>

      <ErrorNote msg={err} />
      {msg && <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">{msg}</div>}

      {view === "data" ? (
        <>
          {/* toolbar */}
          <div className="flex flex-wrap gap-1.5">
            <Btn variant="soft" onClick={openGenerate}>ƒ Generate</Btn>
            <Btn variant="soft" onClick={openRecode}>↺ Recode</Btn>
            <Btn variant="soft" onClick={openFilter}>⧨ Filter</Btn>
            <Btn variant="soft" onClick={openSort}>⇅ Sort</Btn>
            <Btn variant="soft" onClick={() => runTransform("add_variable", { name: prompt("Variable name?") })}>+ Variable</Btn>
            <Btn variant="soft" onClick={() => runTransform("add_row", {})}>+ Case</Btn>
            <Btn variant="soft" onClick={openMissing}>◌ Missing data</Btn>
            <Btn variant="soft" onClick={openDuplicates}>⧉ Duplicates</Btn>
            <Btn variant="ghost" onClick={() => exportDataset(dsid!)}>⬇ Export CSV</Btn>
            <Btn variant="ghost" onClick={() => exportDataset(dsid!, "excel")}>⬇ Excel</Btn>
          </div>

          {/* grid */}
          <div className="overflow-auto rounded-xl border border-slate-200 bg-white">
            {busy && !data ? (
              <Spinner label="Loading data…" />
            ) : (
              <table className="smx-table">
                <thead>
                  <tr>
                    <th className="w-10 text-center text-slate-400">#</th>
                    {data?.columns.map((c: any) => (
                      <th key={c.name} className="sticky top-0">
                        {c.name}
                        <span className="ml-1 font-normal text-slate-400">{c.type === "string" ? "abc" : "123"}</span>
                      </th>
                    ))}
                    <th className="w-8" />
                  </tr>
                </thead>
                <tbody>
                  {data?.rows.map((row: any[], ri: number) => (
                    <tr key={ri} className="group">
                      <td className="text-center text-[11px] text-slate-400">{data.row_start + ri + 1}</td>
                      {row.map((v, ci) => {
                        const colName = data.columns[ci].name;
                        const isEditing = editing && editing.r === data.row_start + ri && editing.c === colName;
                        return (
                          <td key={ci}
                              className={`cursor-cell ${isEditing ? "p-0" : "group-hover:bg-sky-50"}`}
                              onDoubleClick={() => setEditing({ r: data.row_start + ri, c: colName, v: v === null ? "" : String(v) })}>
                            {isEditing ? (
                              <input
                                autoFocus
                                className="w-full min-w-[80px] border border-sky-400 px-2 py-1 text-[12.5px] outline-none"
                                value={editing.v}
                                onChange={(e) => setEditing({ ...editing, v: e.target.value })}
                                onBlur={saveCell}
                                onKeyDown={(e) => {
                                  if (e.key === "Enter") saveCell();
                                  if (e.key === "Escape") setEditing(null);
                                }}
                              />
                            ) : (
                              v === null ? <span className="text-slate-300">·</span> : String(v)
                            )}
                          </td>
                        );
                      })}
                      <td className="p-0 text-center">
                        <button
                          className="px-1 text-[11px] text-slate-300 opacity-0 hover:text-red-500 group-hover:opacity-100"
                          title="Delete case"
                          onClick={() => runTransform("delete_rows", { indices: [data.row_start + ri] })}
                        >✕</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          {/* pagination */}
          <div className="flex items-center justify-between text-[13px] text-slate-500">
            <div>Rows {data ? data.row_start + 1 : 0}–{data ? data.row_start + data.rows.length : 0} of {data?.total?.toLocaleString()}</div>
            <div className="flex items-center gap-1.5">
              <Btn variant="ghost" onClick={() => setPage(1)} disabled={page <= 1}>«</Btn>
              <Btn variant="ghost" onClick={() => setPage(page - 1)} disabled={page <= 1}>‹</Btn>
              <span>Page {page} / {totalPages}</span>
              <Btn variant="ghost" onClick={() => setPage(page + 1)} disabled={page >= totalPages}>›</Btn>
              <Btn variant="ghost" onClick={() => setPage(totalPages)} disabled={page >= totalPages}>»</Btn>
            </div>
          </div>
        </>
      ) : (
        /* ---------- Variable view ---------- */
        <div className="overflow-auto rounded-xl border border-slate-200 bg-white">
          <table className="smx-table">
            <thead>
              <tr>
                <th>#</th><th>Name</th><th>Type</th><th>Label</th><th>Categorical</th><th>Distinct values</th><th></th>
              </tr>
            </thead>
            <tbody>
              {cols.map((c: any, i: number) => (
                <tr key={c.name}>
                  <td>{i + 1}</td>
                  <td className="font-semibold">{c.name}</td>
                  <td>{c.numeric ? "numeric" : "string"}</td>
                  <td>
                    <VariableLabel dsid={dsid} name={c.name} />
                  </td>
                  <td>{c.numeric ? (c.n_unique <= 6 ? "yes (few levels)" : "—") : "yes"}</td>
                  <td>{c.n_unique}</td>
                  <td>
                    <button className="text-[11px] text-slate-400 hover:text-red-500"
                            onClick={() => confirm(`Delete variable ${c.name}?`) && runTransform("delete_variable", { name: c.name })}>
                      ✕
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {dlg && (
        <Modal open title={dlg.title} onClose={() => setDlg(null)}>
          {dlg.body}
          {dlg.op !== "dedupe" && (
            <div className="mt-4 flex justify-end gap-2">
              <Btn variant="ghost" onClick={() => setDlg(null)}>Cancel</Btn>
              <Btn onClick={() => {
                const params = typeof dlg.payload === "function" ? (dlg.payload as any)() : dlg.payload;
                runTransform(dlg.op, params);
              }}>Apply</Btn>
            </div>
          )}
        </Modal>
      )}
    </div>
  );
}

function VariableLabel({ dsid, name }: { dsid: number; name: string }) {
  const [label, setLabel] = useState<string>("");
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    if (loaded) return;
    api<any[]>(`/api/datasets/${dsid}/variables`).then((vs) => {
      setLabel(vs.find((v) => v.name === name)?.label || "");
      setLoaded(true);
    });
  }, [dsid, name, loaded]);
  return (
    <input
      className="w-full min-w-[140px] rounded border border-transparent px-1 py-0.5 hover:border-slate-300 focus:border-sky-400 focus:outline-none"
      value={label}
      placeholder="—"
      onChange={(e) => setLabel(e.target.value)}
      onBlur={async () => {
        await api(`/api/datasets/${dsid}/variables/${name}`, {
          method: "PATCH",
          body: JSON.stringify({ label }),
        });
      }}
    />
  );
}
