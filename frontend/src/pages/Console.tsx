import { useEffect, useRef, useState } from "react";
import { api } from "../api";
import { useApp } from "../state";
import ResultsView from "../components/ResultsView";
import { getOfflineDataset, runOfflineTransform, saveOfflineDataset } from "../offline";

interface Entry {
  cmd: string;
  result: any | null;
  error?: string;
}

export default function Console() {
  const { activeDataset, setActiveDataset, bumpData } = useApp();
  const [entries, setEntries] = useState<Entry[]>([]);
  const [input, setInput] = useState("");
  const [history, setHistory] = useState<string[]>([]);
  const [hIdx, setHIdx] = useState(-1);
  const [busy, setBusy] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    api<string[]>("/api/commands/history?limit=25")
      .then(setHistory)
      .catch(() => {});
  }, [activeDataset?.id]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [entries.length, busy]);

  const run = async () => {
    const cmd = input.trim();
    if (!cmd) return;
    if (!activeDataset) {
      setEntries((e) => [...e, { cmd, result: null, error: "Select a dataset first." }]);
      setInput("");
      return;
    }
    setInput("");
    setHistory((h) => [cmd, ...h.filter((c) => c !== cmd)].slice(0, 50));
    setHIdx(-1);
    setEntries((e) => [...e, { cmd, result: null }]);
    setBusy(true);
    try {
      if (activeDataset.id < 0) {
        const ds = await getOfflineDataset(activeDataset.id);
        if (!ds) throw new Error("The selected offline dataset could not be loaded. Reopen it from Dashboard.");
        const [name, ...tail] = cmd.trim().split(/\s+/);
        const command = name.toLowerCase();
        const rest = tail.join(" ").trim();
        const table = (title: string, columns: string[], rows: any[][], note?: string) => ({
          title, command: cmd,
          blocks: [{ type: "table", name: title, columns: columns.map((label, i) => ({ key: `c${i}`, label })), rows, note }],
        });
        let result: any;
        let changed = false;
        if (command === "help" || command === "h") {
          result = { title: "Offline Stata-style commands", command: cmd, blocks: [{ type: "text", content: "Available offline: describe, list [n], count, summarize (sum), tabulate (tab), generate (gen), keep if, drop if, drop variables, rename, sort, duplicates drop, and clear. Other commands need the connected analysis server." }] };
        } else if (command === "describe" || command === "d") {
          result = table("Dataset description", ["Variable", "Type", "Nonmissing", "Unique"], ds.columns.map((col, j) => {
            const vals = ds.rows.map(r => r[j]).filter(v => v !== null && v !== "");
            return [col, vals.some(v => typeof v === "number") ? "numeric" : "string", vals.length, new Set(vals.map(String)).size];
          }), `${ds.n_rows} observations · ${ds.n_cols} variables`);
        } else if (command === "count") {
          result = { title: "Observations", command: cmd, blocks: [{ type: "text", content: `${ds.n_rows} observations` }] };
        } else if (command === "list" || command === "browse") {
          const n = Math.max(1, Math.min(200, Number(rest.split(/[ ,]/)[0]) || 10));
          result = table("Data listing", ds.columns, ds.rows.slice(0, n), `Showing ${Math.min(n, ds.n_rows)} of ${ds.n_rows} observations`);
        } else if (["summarize", "sum", "su"].includes(command)) {
          const vars = rest.split(/[ ,]+/).filter(Boolean);
          const cols = vars.length ? vars : ds.columns;
          result = table("Summary statistics", ["Variable", "N", "Mean", "SD", "Min", "Max"], cols.map(v => {
            const j = ds.columns.indexOf(v); if (j < 0) throw new Error(`Variable not found: ${v}`);
            const a = ds.rows.map(r => Number(r[j])).filter(Number.isFinite);
            const m = a.length ? a.reduce((s, x) => s + x, 0) / a.length : NaN;
            const sd = a.length > 1 ? Math.sqrt(a.reduce((s, x) => s + (x - m) ** 2, 0) / (a.length - 1)) : NaN;
            return [v, a.length, m, sd, a.length ? Math.min(...a) : NaN, a.length ? Math.max(...a) : NaN].map(x => typeof x === "number" && Number.isFinite(x) ? Number(x.toFixed(4)) : x);
          }));
        } else if (["tab", "tabulate"].includes(command)) {
          const v = rest.split(/[ ,]+/).filter(Boolean)[0]; const j = ds.columns.indexOf(v);
          if (j < 0) throw new Error(`Variable not found: ${v || ""}`);
          const counts = new Map<string, number>(); ds.rows.forEach(r => { const k = String(r[j] ?? "Missing"); counts.set(k, (counts.get(k) || 0) + 1); });
          result = table(`Tabulation: ${v}`, [v, "Frequency", "Percent"], [...counts].map(([k, n]) => [k, n, Number((n * 100 / (ds.n_rows || 1)).toFixed(2))]));
        } else if (["gen", "generate"].includes(command)) {
          const m = /^([A-Za-z_][\w]*)\s*=\s*(.+)$/.exec(rest);
          if (!m) throw new Error("Syntax: generate newvar = expression");
          const out = runOfflineTransform(ds, "generate", { name: m[1], expression: m[2] });
          await saveOfflineDataset(out.dataset); setActiveDataset(out.dataset); changed = true;
          result = { title: "Command completed", command: cmd, blocks: [{ type: "text", content: out.message }] };
        } else if (["keep", "drop"].includes(command) && /^if\s+/i.test(rest)) {
          const condition = rest.replace(/^if\s+/i, "");
          const out = runOfflineTransform(ds, "filter", { condition: command === "keep" ? condition : `!(${condition})` });
          const next = out.dataset;
          await saveOfflineDataset(next); setActiveDataset(next); changed = true;
          result = { title: "Command completed", command: cmd, blocks: [{ type: "text", content: `${next.n_rows} observations remain.` }] };
        } else if (command === "sort") {
          const out = runOfflineTransform(ds, "sort", { variables: rest.split(/[ ,]+/).filter(Boolean) });
          await saveOfflineDataset(out.dataset); setActiveDataset(out.dataset); changed = true;
          result = { title: "Command completed", command: cmd, blocks: [{ type: "text", content: out.message }] };
        } else if (command === "drop") {
          const remove = rest.split(/[ ,]+/).filter(Boolean);
          if (!remove.length || remove.some(v => !ds.columns.includes(v))) throw new Error("Specify existing variable names to drop.");
          const keep = ds.columns.map((_, i) => i).filter(i => !remove.includes(ds.columns[i]));
          const next = { ...ds, columns: keep.map(i => ds.columns[i]), rows: ds.rows.map(r => keep.map(i => r[i])), n_cols: keep.length };
          await saveOfflineDataset(next); setActiveDataset(next); changed = true;
          result = { title: "Command completed", command: cmd, blocks: [{ type: "text", content: `Dropped ${remove.join(", ")}.` }] };
        } else if (command === "rename") {
          const m = /^([\w]+)\s+([\w]+)$/.exec(rest);
          if (!m || !ds.columns.includes(m[1])) throw new Error("Syntax: rename oldvar newvar (old variable must exist)");
          if (ds.columns.includes(m[2])) throw new Error(`Variable already exists: ${m[2]}`);
          const next = { ...ds, columns: ds.columns.map(v => v === m[1] ? m[2] : v) };
          await saveOfflineDataset(next); setActiveDataset(next); changed = true;
          result = { title: "Command completed", command: cmd, blocks: [{ type: "text", content: `Renamed ${m[1]} to ${m[2]}.` }] };
        } else if (command === "clear") {
          result = { title: "Dataset retained", command: cmd, blocks: [{ type: "text", content: "Offline clear does not delete your dataset. Use Dashboard to remove it." }] };
        } else {
          throw new Error(`“${command}” needs the connected analysis server. Type help to see commands available offline.`);
        }
        setEntries((e) => { const copy = [...e]; copy[copy.length - 1] = { cmd, result }; return copy; });
        if (changed) bumpData();
        setBusy(false);
        return;
      }
      const res = await api<any>("/api/commands", {
        method: "POST",
        body: JSON.stringify({ dataset_id: activeDataset.id, command: cmd }),
      });
      setEntries((e) => {
        const copy = [...e];
        copy[copy.length - 1] = { cmd, result: res.result };
        return copy;
      });
      if (/^(generate|gen|recode|replace|drop|keep|sort|rename|clear)\b/.test(cmd)) bumpData();
    } catch (e: any) {
      setEntries((e2) => {
        const copy = [...e2];
        copy[copy.length - 1] = { cmd, result: null, error: e.message };
        return copy;
      });
    } finally {
      setBusy(false);
    }
  };

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      run();
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      const ni = Math.min(hIdx + 1, history.length - 1);
      if (ni >= 0) {
        setHIdx(ni);
        setInput(history[ni]);
      }
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      const ni = hIdx - 1;
      setHIdx(ni);
      setInput(ni >= 0 ? history[ni] : "");
    }
  };

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-extrabold tracking-tight text-slate-900">Command console</h1>
        <p className="text-[13px] text-slate-500">
          Stata-style commands on <b>{activeDataset?.name || "—"}</b>. Type <code className="mono rounded bg-slate-100 px-1">help</code> for the command list. ↑/↓ = history.
        </p>
      </div>

      <div className="rounded-2xl border border-slate-800 bg-slate-900 p-4 shadow-inner">
        {entries.length === 0 && (
          <div className="mono mb-3 text-[12.5px] text-slate-400">
            <span className="text-emerald-400">statmedx</span> — command console ready. try:
            <span className="text-sky-300"> summarize age bmi</span> ·
            <span className="text-sky-300"> ttest sbp, by(group)</span> ·
            <span className="text-sky-300"> logistic outcome age smoking</span>
          </div>
        )}
        <div className="space-y-3">
          {entries.map((en, i) => (
            <div key={i}>
              <div className="mono text-[13px] text-emerald-300">
                <span className="text-slate-500">.</span> {en.cmd}
              </div>
              {en.error && <div className="mono mt-1 text-[12.5px] text-red-400">error: {en.error}</div>}
              {en.result && (
                <div className="mt-1.5 rounded-xl bg-white p-3">
                  <ResultsView result={en.result} compact />
                </div>
              )}
            </div>
          ))}
          {busy && <div className="mono text-[12.5px] text-slate-400">running…</div>}
        </div>

        <div className="mt-3 flex items-center gap-2 rounded-lg bg-slate-800 px-3 py-2">
          <span className="mono text-emerald-400">.</span>
          <input
            className="mono w-full bg-transparent text-[13.5px] text-slate-100 outline-none placeholder:text-slate-500"
            placeholder="type a command…"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={onKey}
            autoFocus
          />
          <button className="rounded-md bg-sky-600 px-3 py-1 text-[12px] font-bold text-white hover:bg-sky-500"
                  onClick={run} disabled={busy}>
            ⏎
          </button>
        </div>
      </div>

      {history.length > 0 && (
        <div>
          <div className="mb-1.5 text-[11px] font-bold uppercase tracking-wider text-slate-400">Command history</div>
          <div className="flex flex-wrap gap-1.5">
            {history.map((h, i) => (
              <button key={i}
                      className="mono rounded-md border border-slate-200 bg-white px-2 py-1 text-[11.5px] text-slate-600 hover:border-sky-300 hover:text-sky-700"
                      onClick={() => setInput(h)}>
                {h}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
