import { useMemo } from "react";

type Trace = {
  type?: string;
  x?: any[];
  y?: any[];
  name?: string;
  mode?: string;
};

export default function PlotlyChart({ spec, title }: { spec: any; title?: string }) {
  const traces: Trace[] = Array.isArray(spec?.data) ? spec.data : [];
  const layout = spec?.layout || {};
  const points = useMemo(() => {
    const all: {x:number;y:number;trace:number}[] = [];
    traces.forEach((t, ti) => {
      const xs = Array.isArray(t.x) ? t.x : [];
      const ys = Array.isArray(t.y) ? t.y : [];
      const n = Math.min(xs.length, ys.length);
      for (let i=0;i<n;i++) {
        const x=Number(xs[i]), y=Number(ys[i]);
        if (Number.isFinite(x) && Number.isFinite(y)) all.push({x,y,trace:ti});
      }
    });
    return all;
  }, [spec]);

  const numeric = points.length > 0;
  const xs = numeric ? points.map(p=>p.x) : [];
  const ys = numeric ? points.map(p=>p.y) : [];
  const xmin = numeric ? Math.min(...xs) : 0, xmax = numeric ? Math.max(...xs) : 1;
  const ymin = numeric ? Math.min(...ys) : 0, ymax = numeric ? Math.max(...ys) : 1;
  const dx = xmax-xmin || 1, dy = ymax-ymin || 1;
  const W=720,H=360,L=58,R=18,T=24,B=44;
  const px=(x:number)=>L+(x-xmin)/dx*(W-L-R);
  const py=(y:number)=>H-B-(y-ymin)/dy*(H-T-B);

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-3">
      {title && <div className="px-2 pt-1 pb-2 text-xs font-semibold text-slate-500 uppercase tracking-wide">{title}</div>}
      {!numeric ? (
        <div className="p-8 text-center text-sm text-slate-400">No plottable numeric data.</div>
      ) : (
        <div className="w-full overflow-x-auto">
          <svg viewBox={`0 0 ${W} ${H}`} className="h-auto min-w-[560px] w-full" role="img" aria-label={title || "Chart"}>
            <rect x={L} y={T} width={W-L-R} height={H-T-B} fill="none" stroke="currentColor" className="text-slate-200"/>
            {traces.map((t,ti)=>{
              const pts=points.filter(p=>p.trace===ti).map(p=>`${px(p.x)},${py(p.y)}`).join(" ");
              return <polyline key={ti} points={pts} fill="none" stroke="currentColor" className="text-sky-600" strokeWidth="2"/>;
            })}
            {points.map((p,i)=><circle key={i} cx={px(p.x)} cy={py(p.y)} r="2.5" className="fill-sky-600"/>)}
            <text x={W/2} y={H-8} textAnchor="middle" className="fill-slate-500 text-[12px]">{layout.xaxis?.title?.text || ""}</text>
            <text x="14" y={H/2} textAnchor="middle" transform={`rotate(-90 14 ${H/2})`} className="fill-slate-500 text-[12px]">{layout.yaxis?.title?.text || ""}</text>
          </svg>
        </div>
      )}
    </div>
  );
}
