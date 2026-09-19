import { useEffect, useRef, useState } from "react";
import { api } from "../api";
import { useApp } from "../state";
import ResultsView from "../components/ResultsView";

interface Entry {
  cmd: string;
  result: any | null;
  error?: string;
}

export default function Console() {
  const { activeDataset, bumpData } = useApp();
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
