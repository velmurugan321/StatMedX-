import { useMemo } from "react";

type Trace = { type?: string; x?: any[]; y?: any[]; name?: string; mode?: string; nbinsx?: number };
const COLORS = ["#0284c7", "#f97316", "#16a34a", "#9333ea", "#db2777"];
const W = 720, H = 360, L = 58, R = 18, T = 24, B = 48;
const q = (a: number[], p: number) => { const i=(a.length-1)*p,lo=Math.floor(i),f=i-lo;return a[lo]+(a[lo+1]===undefined?0:f*(a[lo+1]-a[lo])); };

export default function PlotlyChart({ spec, title }: { spec: any; title?: string }) {
  const traces: Trace[] = Array.isArray(spec?.data) ? spec.data : [];
  const layout = spec?.layout || {};
  const type = traces[0]?.type || "scatter";
  const chart = useMemo(() => {
    if (type === "histogram") {
      const source = traces.flatMap(t => Array.isArray(t.x) ? t.x.map(Number).filter(Number.isFinite) : []);
      if (!source.length) return null;
      let min=Infinity,max=-Infinity;for(const v of source){if(v<min)min=v;if(v>max)max=v;}if(min===max){min-=0.5;max+=0.5;}
      const bins=Math.max(1,Math.min(100,Math.round(traces[0]?.nbinsx||20))),width=(max-min)/bins,counts=Array(bins).fill(0);
      source.forEach(v=>counts[Math.min(bins-1,Math.floor((v-min)/width))]++);
      const peak=Math.max(1,...counts),x=i=>L+i/bins*(W-L-R),y=v=>H-B-v/peak*(H-T-B);
      return <g>{counts.map((v,i)=><rect key={i} x={x(i)+0.5} y={y(v)} width={Math.max(0,(W-L-R)/bins-1)} height={Math.max(0,H-B-y(v))} fill="#0ea5e9" stroke="#0284c7"/>)}<Axis min={min} max={max} layout={layout}/></g>;
    }
    if (type === "bar") {
      const labels=[...new Set(traces.flatMap(t=>Array.isArray(t.x)?t.x.map(String):[]))];
      const vals=traces.flatMap(t=>Array.isArray(t.y)?t.y.map(Number).filter(Number.isFinite):[]);if(!labels.length||!vals.length)return null;
      const peak=Math.max(1,...vals),slot=(W-L-R)/labels.length,barW=slot/Math.max(1,traces.length)*0.82,y=v=>H-B-v/peak*(H-T-B);
      return <g>{traces.flatMap((tr,ti)=>(tr.x||[]).map((label,i)=>{const ci=labels.indexOf(String(label)),v=Number(tr.y?.[i]);if(ci<0||!Number.isFinite(v))return null;const x=L+ci*slot+ti*barW+slot*0.09;return <rect key={`${ti}-${i}`} x={x} y={y(v)} width={barW} height={Math.max(0,H-B-y(v))} fill={COLORS[ti%COLORS.length]}/>;}))}<Axis min={0} max={peak} layout={layout}/>{labels.map((label,i)=><text key={i} x={L+(i+0.5)*slot} y={H-B+16} textAnchor="middle" className="fill-slate-500 text-[10px]">{label}</text>)}</g>;
    }
    if (type === "box") {
      const boxes=traces.map((tr,i)=>{const values=(tr.y||[]).map(Number).filter(Number.isFinite).sort((a,b)=>a-b);if(!values.length)return null;return {name:tr.name||`Series ${i+1}`,min:values[0],max:values[values.length-1],q1:q(values,.25),med:q(values,.5),q3:q(values,.75)};}).filter(Boolean) as {name:string;min:number;max:number;q1:number;med:number;q3:number}[];
      if(!boxes.length)return null;let min=Math.min(...boxes.map(x=>x.min)),max=Math.max(...boxes.map(x=>x.max));if(min===max){min-=0.5;max+=0.5;}const y=v=>H-B-(v-min)/(max-min)*(H-T-B),slot=(W-L-R)/boxes.length,bw=Math.min(72,slot*.5);
      return <g>{boxes.map((b,i)=>{const cx=L+(i+0.5)*slot;return <g key={b.name}><line x1={cx} x2={cx} y1={y(b.min)} y2={y(b.q1)} stroke="#334155"/><line x1={cx} x2={cx} y1={y(b.q3)} y2={y(b.max)} stroke="#334155"/><line x1={cx-bw*.25} x2={cx+bw*.25} y1={y(b.min)} y2={y(b.min)} stroke="#334155"/><line x1={cx-bw*.25} x2={cx+bw*.25} y1={y(b.max)} y2={y(b.max)} stroke="#334155"/><rect x={cx-bw/2} y={y(b.q3)} width={bw} height={Math.max(1,y(b.q1)-y(b.q3))} fill="#bae6fd" stroke="#0284c7"/><line x1={cx-bw/2} x2={cx+bw/2} y1={y(b.med)} y2={y(b.med)} stroke="#0f172a" strokeWidth="2"/><text x={cx} y={H-B+16} textAnchor="middle" className="fill-slate-500 text-[10px]">{b.name}</text></g>;})}<Axis min={min} max={max} layout={layout}/></g>;
    }
    const points:{x:number;y:number;trace:number}[]=[];
    traces.forEach((tr,ti)=>{const xs=Array.isArray(tr.x)?tr.x:[],ys=Array.isArray(tr.y)?tr.y:[];for(let i=0;i<Math.min(xs.length,ys.length);i++){const x=Number(xs[i]),y=Number(ys[i]);if(Number.isFinite(x)&&Number.isFinite(y))points.push({x,y,trace:ti});}});
    if(!points.length)return null;
    let xmin=Infinity,xmax=-Infinity,ymin=Infinity,ymax=-Infinity;for(const p of points){if(p.x<xmin)xmin=p.x;if(p.x>xmax)xmax=p.x;if(p.y<ymin)ymin=p.y;if(p.y>ymax)ymax=p.y;}if(xmin===xmax){xmin-=.5;xmax+=.5;}if(ymin===ymax){ymin-=.5;ymax+=.5;}
    const px=(v:number)=>L+(v-xmin)/(xmax-xmin)*(W-L-R),py=(v:number)=>H-B-(v-ymin)/(ymax-ymin)*(H-T-B);
    return <g>{traces.map((tr,ti)=>{const pts=points.filter(p=>p.trace===ti),step=Math.max(1,Math.ceil(pts.length/5000)),visible=pts.filter((_,i)=>i%step===0);return <g key={ti}>{tr.mode?.includes("lines")&&<polyline points={pts.map(p=>`${px(p.x)},${py(p.y)}`).join(" ")} fill="none" stroke={COLORS[ti%COLORS.length]} strokeWidth="2"/>}{tr.mode?.includes("markers")!==false&&visible.map((p,i)=><circle key={i} cx={px(p.x)} cy={py(p.y)} r="3" fill={COLORS[ti%COLORS.length]}/>)}</g>;})}<Axis min={xmin} max={xmax} layout={layout}/><text x="14" y={H/2} textAnchor="middle" transform={`rotate(-90 14 ${H/2})`} className="fill-slate-500 text-[12px]">{layout.yaxis?.title?.text||""}</text></g>;
  }, [traces, layout, type]);

  return <div className="rounded-xl border border-slate-200 bg-white p-3">{title&&<div className="px-2 pt-1 pb-2 text-xs font-semibold text-slate-500 uppercase tracking-wide">{title}</div>}<div className="w-full overflow-x-auto"><svg viewBox={`0 0 ${W} ${H}`} className="h-auto min-w-[560px] w-full" role="img" aria-label={title||"Chart"}><rect x={L} y={T} width={W-L-R} height={H-T-B} fill="none" stroke="currentColor" className="text-slate-200"/>{chart||<text x={W/2} y={H/2} textAnchor="middle" className="fill-slate-400 text-sm">No plottable data.</text>}</svg></div></div>;
}

function Axis({ min, max, layout }: { min: number; max: number; layout: any }) {
  return <g>{[0,.25,.5,.75,1].map((f,i)=>{const x=L+f*(W-L-R),v=min+f*(max-min);return <g key={i}><line x1={x} x2={x} y1={H-B} y2={H-B+4} stroke="#94a3b8"/><text x={x} y={H-B+13} textAnchor="middle" className="fill-slate-500 text-[9px]">{Number(v.toPrecision(3))}</text></g>;})}<text x={W/2} y={H-5} textAnchor="middle" className="fill-slate-500 text-[12px]">{layout.xaxis?.title?.text||""}</text><text x="14" y={H/2} textAnchor="middle" transform={`rotate(-90 14 ${H/2})`} className="fill-slate-500 text-[12px]">{layout.yaxis?.title?.text||""}</text></g>;
}

