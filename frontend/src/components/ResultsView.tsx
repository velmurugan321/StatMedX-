import React from "react";
import PlotlyChart from "./PlotlyChart";

function safeResultMarkup(markup: string): string {
  const source = new DOMParser().parseFromString(String(markup || ""), "text/html");
  const allowed = new Set(["b", "strong", "i", "em", "code", "pre", "br", "sub", "sup"]);
  const forbidden = new Set(["script", "style", "iframe", "object", "embed", "svg", "math"]);
  const copy = (node: Node): Node | null => {
    if (node.nodeType === Node.TEXT_NODE) return document.createTextNode(node.textContent || "");
    if (!(node instanceof HTMLElement)) return null;
    if (forbidden.has(node.localName)) return null;
    if (allowed.has(node.localName)) {
      const clean = document.createElement(node.localName);
      node.childNodes.forEach(child => { const safe = copy(child); if (safe) clean.appendChild(safe); });
      return clean;
    }
    const fragment = document.createDocumentFragment();
    node.childNodes.forEach(child => { const safe = copy(child); if (safe) fragment.appendChild(safe); });
    return fragment;
  };
  const clean = document.createElement("div");
  source.body.childNodes.forEach(node => { const safe = copy(node); if (safe) clean.appendChild(safe); });
  return clean.innerHTML;
}

/** Renders the common result format: {title, command?, blocks:[text|table|figure|code]} */
export function ResultBlocks({ result }: { result: any }) {
  return (
    <div className="space-y-4">
      {(Array.isArray(result?.blocks) ? result.blocks : []).map((b: any, i: number) => {
        if (b.type === "text")
          return (
            <div key={i} className="text-sm leading-relaxed text-slate-700"
                 dangerouslySetInnerHTML={{ __html: safeResultMarkup(b.content) }} />
          );
        if (b.type === "code")
          return (
            <pre key={i} className="mono overflow-x-auto rounded-lg bg-slate-900 p-3 text-[12.5px] leading-relaxed text-emerald-200">
              {b.content}
            </pre>
          );
        if (b.type === "table")
          return (
            <div key={i}>
              {b.name && (
                <div className="mb-1.5 text-xs font-bold uppercase tracking-wide text-slate-500">{b.name}</div>
              )}
              <div className="overflow-x-auto rounded-lg border border-slate-200">
                <table className="smx-table">
                  <thead>
                    <tr>
                      {(Array.isArray(b.columns) ? b.columns : []).map((c: any) => (
                        <th key={c.key}>{c.label}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {(Array.isArray(b.rows) ? b.rows : []).map((r: any[], ri: number) => (
                      <tr key={ri}>
                        {r.map((v, ci) => (
                          <td key={ci} className={ci === 0 ? "font-medium text-slate-700" : ""}>
                            {v === null || v === undefined ? "" : String(v)}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {b.note && <div className="mt-1 text-[11.5px] text-slate-400">{b.note}</div>}
            </div>
          );
        if (b.type === "figure") {
          if (b.spec?._custom === "forest") return <ForestPlot key={i} payload={b.spec.payload} />;
          return <PlotlyChart key={i} spec={b.spec} title={b.name} />;
        }
        return null;
      })}
    </div>
  );
}

/** Custom forest plot renderer (used by meta-analysis). */
export function ForestPlot({ payload }: { payload: any }) {
  const rows: any[] = payload.rows || [];
  const allEffects = rows.flatMap((r) => [r.effect, r.lo, r.hi]).filter((v) => isFinite(v));
  const min = Math.min(...allEffects), max = Math.max(...allEffects);
  const pad = (max - min) * 0.12 || 0.5;
  const lo = min - pad, hi = max + pad;
  const px = (v: number) => `${((v - lo) / (hi - lo)) * 100}%`;
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4">
      <div className="mb-2 text-xs font-bold uppercase tracking-wide text-slate-500">Forest plot</div>
      <div className="min-w-[560px]">
        <div className="grid grid-cols-[170px_1fr_150px] gap-x-3 text-[12px]">
          <div />
          <div className="relative mb-1 h-4">
            {[lo, (lo + hi) / 2, hi].map((v, i) => (
              <span key={i} className="absolute -translate-x-1/2 text-[10px] text-slate-400" style={{ left: px(v) }}>
                {v.toFixed(2)}
              </span>
            ))}
          </div>
          <div className="pb-1 text-[10px] font-semibold uppercase text-slate-400">{payload.xlabel || "Effect (95% CI)"}</div>
          {rows.map((r, i) => (
            <React.Fragment key={i}>
              <div className={`py-1 ${r.kind !== "study" ? "font-bold" : ""} truncate`}>{r.label}</div>
              <div className="relative h-5">
                <div className="absolute top-1/2 h-px w-full bg-slate-200" />
                {r.kind !== "study" && <div className="absolute top-1/2 h-px w-px" style={{ left: px(0) }} />}
                {isFinite(r.lo) && isFinite(r.hi) && (
                  <>
                    <div
                      className="absolute top-1/2 h-[3px] -translate-y-1/2 rounded"
                      style={{
                        left: px(r.lo),
                        width: `calc(${px(r.hi)} - ${px(r.lo)})`,
                        background: r.kind === "fixed" ? "#0284c7" : r.kind === "random" ? "#ea580c" : "#64748b",
                      }}
                    />
                    <div
                      className="absolute top-1/2 h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rotate-45"
                      style={{
                        left: px(r.effect),
                        background: r.kind === "fixed" ? "#0284c7" : r.kind === "random" ? "#ea580c" : "#334155",
                      }}
                    />
                  </>
                )}
              </div>
              <div className="py-1 text-slate-600">
                {r.effect.toFixed(3)} [{r.lo.toFixed(3)}, {r.hi.toFixed(3)}]
              </div>
            </React.Fragment>
          ))}
        </div>
      </div>
      <div className="mt-2 flex gap-4 text-[11px] text-slate-500">
        <span>◆ study (95% CI)</span>
        <span className="text-sky-600">◆ fixed effect (IV)</span>
        <span className="text-orange-600">◆ random effects (DL)</span>
      </div>
    </div>
  );
}

export default function ResultsView({ result, compact }: { result: any; compact?: boolean }) {
  if (!result) return null;
  return (
    <div className={compact ? "" : "rounded-2xl border border-slate-200 bg-white p-5"}>
      <div className="mb-3">
        <h3 className="text-[15px] font-bold text-slate-800">{result.title}</h3>
        {result.command && (
          <div className="mono mt-1 inline-block rounded-md bg-slate-100 px-2 py-0.5 text-[12px] text-slate-600">
            . {result.command}
          </div>
        )}
      </div>
      <ResultBlocks result={result} />
    </div>
  );
}
