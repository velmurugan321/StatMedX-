import { useEffect, useRef } from "react";
import Plotly from "plotly.js-dist-min";

export default function PlotlyChart({ spec, title }: { spec: any; title?: string }) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!ref.current || !spec?.data) return;
    Plotly.react(ref.current, spec.data, {
      responsive: true,
      ...spec.layout,
    } as any, { displaylogo: false, responsive: true } as any);
    return () => {
      try {
        Plotly.purge(ref.current!);
      } catch {
        /* noop */
      }
    };
  }, [spec]);

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-3">
      {title && <div className="px-2 pt-1 pb-2 text-xs font-semibold text-slate-500 uppercase tracking-wide">{title}</div>}
      <div ref={ref} />
    </div>
  );
}
