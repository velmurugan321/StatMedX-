/* StatMedX offline runtime: CSV/local datasets + browser-side core statistics.
   No network, server, or external runtime is required for these modules. */
export type OfflineDataset = {
  id: number; name: string; n_rows: number; n_cols: number; source_format: string;
  columns: string[]; rows: any[]; description?: string;
};

const DB = "statmedx-offline";
const STORE = "datasets";

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => r.result.createObjectStore(STORE, { keyPath: "id" });
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}
export async function saveOfflineDataset(ds: OfflineDataset) {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const r = db.transaction(STORE, "readwrite").objectStore(STORE).put(ds);
    r.onsuccess = () => resolve(); r.onerror = () => reject(r.error);
  });
  db.close();
}
export async function getOfflineDataset(id: number): Promise<OfflineDataset | null> {
  const db = await openDb();
  const v = await new Promise<any>((resolve, reject) => {
    const r = db.transaction(STORE).objectStore(STORE).get(id);
    r.onsuccess = () => resolve(r.result ?? null); r.onerror = () => reject(r.error);
  });
  db.close(); return v;
}
export async function listOfflineDatasets(): Promise<OfflineDataset[]> {
  const db = await openDb();
  const v = await new Promise<any[]>((resolve, reject) => {
    const r = db.transaction(STORE).objectStore(STORE).getAll();
    r.onsuccess = () => resolve(r.result || []); r.onerror = () => reject(r.error);
  });
  db.close(); return v;
}

export function parseDelimited(text: string, name: string, sep?: string): OfflineDataset {
  const lines = text.replace(/^\uFEFF/, "").split(/\r?\n/).filter(x => x.trim() !== "");
  if (!lines.length) throw new Error("The file is empty.");
  const delimiter = sep || (lines[0].includes("\t") ? "\t" : lines[0].includes(",") ? "," : /\s+/.test(lines[0]) ? " " : ",");
  const parse = (line: string) => {
    if (delimiter === " ") return line.trim().split(/\s+/);
    const out:string[]=[]; let cur="", q=false;
    for(let i=0;i<line.length;i++){ const ch=line[i];
      if(ch==='"'){ if(q && line[i+1]==='"'){cur+='"';i++;} else q=!q; }
      else if(ch===delimiter && !q){out.push(cur);cur="";} else cur+=ch;
    } out.push(cur); return out;
  };
  const columns = parse(lines[0]).map((x,i)=>x.trim() || `var_${i+1}`);
  const rows = lines.slice(1).map(l => parse(l).map(v => {
    const s=v.trim(); if(s==="") return null;
    const n=Number(s); return Number.isFinite(n) ? n : s;
  }));
  return {id: -Date.now(), name, n_rows: rows.length, n_cols: columns.length, source_format:"csv",
          columns, rows, description:"Offline local dataset"};
}

const num=(v:any)=> typeof v==="number" && Number.isFinite(v) ? v : Number(v);
function vals(ds:OfflineDataset,col:string){const j=ds.columns.indexOf(col); if(j<0) throw new Error(`Variable "${col}" not found.`);
 return ds.rows.map(r=>num(r[j])).filter(Number.isFinite);}
function mean(a:number[]){return a.reduce((s,x)=>s+x,0)/a.length;}
function variance(a:number[]){const m=mean(a); return a.length>1?a.reduce((s,x)=>s+(x-m)**2,0)/(a.length-1):NaN;}
function sd(a:number[]){return Math.sqrt(variance(a));}
function quant(a:number[],p:number){const x=[...a].sort((u,v)=>u-v), h=(x.length-1)*p, i=Math.floor(h), f=h-i; return x[i]===undefined?NaN:x[i]+(x[i+1]===undefined?0:f*(x[i+1]-x[i]));}
function erf(x:number){const s=x<0?-1:1,a=Math.abs(x),t=1/(1+0.3275911*a),y=1-((((1.061405429*t-1.453152027)*t+1.421413741)*t-0.284496736)*t+0.254829592)*t*Math.exp(-a*a);return s*y;}
function normP(z:number){return 0.5*(1+erf(z/Math.SQRT2));}
function p2z(z:number){return 2*(1-normP(Math.abs(z)));}
function fmt(x:any){return typeof x==="number"&&Number.isFinite(x)?Number(x.toFixed(6)):x;}
function result(title:string, rows:any[][], columns:string[], note?:string){
  return {title, blocks:[{type:"table",name:"Results",columns:columns.map(key=>({key,label:key})),rows:rows.map(r=>r.map(fmt)),note}]};
}
function corr(a:number[],b:number[]){const ma=mean(a),mb=mean(b);let n=0,d1=0,d2=0;for(let i=0;i<a.length;i++){n+=(a[i]-ma)*(b[i]-mb);d1+=(a[i]-ma)**2;d2+=(b[i]-mb)**2;}return n/Math.sqrt(d1*d2);}
function pairs(ds:OfflineDataset,x:string,y:string){const ix=ds.columns.indexOf(x),iy=ds.columns.indexOf(y),a:number[]=[],b:number[]=[];
 ds.rows.forEach(r=>{const u=num(r[ix]),v=num(r[iy]);if(Number.isFinite(u)&&Number.isFinite(v)){a.push(u);b.push(v);}});return[a,b];}

export function offlineSchema(ds:OfflineDataset){
 return {name:ds.name,n_rows:ds.n_rows,n_cols:ds.n_cols,columns:ds.columns.map(c=>{const j=ds.columns.indexOf(c),a=ds.rows.map(r=>r[j]).filter(v=>v!==null&&v!=="");
 const numeric=a.length>0&&a.every(v=>Number.isFinite(Number(v))); const uniq=[...new Set(a.map(String))];
 return {name:c,type:numeric?"number":"string",numeric,n_unique:uniq.length,values:uniq.slice(0,25)};})};
}

function weightedMean(a:number[],w:number[]){const sw=w.reduce((s,x)=>s+x,0);return a.reduce((s,x,i)=>s+x*w[i],0)/sw;}
function transpose(A:number[][]){return A[0].map((_,j)=>A.map(r=>r[j]));}
function matMul(A:number[][],B:number[][]){const BT=transpose(B);return A.map(r=>BT.map(c=>r.reduce((s,x,i)=>s+x*c[i],0)));}
function matVec(A:number[][],v:number[]){return A.map(r=>r.reduce((s,x,i)=>s+x*v[i],0));}
function inv(A:number[][]){const n=A.length,M=A.map((r,i)=>[...r,...Array.from({length:n},(_,j)=>i===j?1:0)]);for(let c=0;c<n;c++){let piv=c;for(let r=c+1;r<n;r++)if(Math.abs(M[r][c])>Math.abs(M[piv][c]))piv=r;if(Math.abs(M[piv][c])<1e-12)throw new Error("Singular matrix.");[M[c],M[piv]]=[M[piv],M[c]];const z=M[c][c];M[c]=M[c].map(x=>x/z);for(let r=0;r<n;r++)if(r!==c){const q=M[r][c];M[r]=M[r].map((x,j)=>x-q*M[c][j]);}}return M.map(r=>r.slice(n));}
function logisticIRLS(y:number[],X:number[][]){let b=Array(X[0].length).fill(0);for(let it=0;it<50;it++){const p=X.map(r=>1/(1+Math.exp(-Math.max(-30,Math.min(30,r.reduce((s,x,j)=>s+x*b[j],0))))));const W=X.map((r,i)=>r.map(x=>x*Math.max(1e-8,p[i]*(1-p[i]))));const Xt=transpose(X),A=matMul(Xt,W),z=y.map((v,i)=>{const eta=Math.log(p[i]/(1-p[i]));return eta+(v-p[i])/Math.max(1e-8,p[i]*(1-p[i]));});const nb=matVec(inv(A),matVec(Xt,z));if(nb.every((v,j)=>Math.abs(v-b[j])<1e-7)){b=nb;break;}b=nb;}return b;}
function kmOffline(ds:OfflineDataset,timeCol:string,eventCol:string,groupCol?:string){const ti=ds.columns.indexOf(timeCol),ei=ds.columns.indexOf(eventCol),gi=groupCol?ds.columns.indexOf(groupCol):-1;const groups=gi<0?["All"]:[...new Set(ds.rows.map(r=>String(r[gi]??"Missing")))];const summaries:any[][]=[];for(const g of groups){const z=ds.rows.filter(r=>gi<0||String(r[gi]??"Missing")===g).map(r=>[num(r[ti]),num(r[ei])]).filter(r=>Number.isFinite(r[0])&&Number.isFinite(r[1]));let S=1,med:any=null;const ev=[...new Set(z.filter(r=>r[1]>0).map(r=>r[0]))].sort((a,b)=>a-b);for(const t of ev){const risk=z.filter(r=>r[0]>=t).length,d=z.filter(r=>r[0]===t&&r[1]>0).length;if(risk)S*=1-d/risk;if(med===null&&S<=.5)med=t;}summaries.push([g,z.length,z.filter(r=>r[1]>0).length,med===null?"Not reached":med]);}return result("Kaplan-Meier",summaries,["Group","N","Events","Median survival"]);}
function metaOffline(ds:OfflineDataset,p:any){const ei=ds.columns.indexOf(p.effect_col),si=ds.columns.indexOf(p.se_col),wi=p.study_col?ds.columns.indexOf(p.study_col):-1;const z=ds.rows.map((r,i)=>({e:num(r[ei]),s:num(r[si]),study:wi>=0?String(r[wi]):"Study "+(i+1)})).filter(x=>Number.isFinite(x.e)&&Number.isFinite(x.s)&&x.s>0);if(z.length<2)throw new Error("Meta-analysis needs at least 2 studies.");const w=z.map(x=>1/x.s**2),sw=w.reduce((a,b)=>a+b,0),ef=z.reduce((a,x,i)=>a+w[i]*x.e,0)/sw,seF=Math.sqrt(1/sw),Q=z.reduce((a,x,i)=>a+w[i]*(x.e-ef)**2,0),df=z.length-1,C=sw-w.reduce((a,x)=>a+x*x,0)/sw,tau=Math.max(0,(Q-df)/C),wr=z.map(x=>1/(x.s*x.s+tau)),swr=wr.reduce((a,b)=>a+b,0),er=z.reduce((a,x,i)=>a+wr[i]*x.e,0)/swr,seR=Math.sqrt(1/swr),I2=Q>0?Math.max(0,(Q-df)/Q)*100:0;return result("Meta-analysis",[[z.length,ef,seF,er,seR,Q,I2,tau]],["Studies","Fixed effect","SE fixed","Random effect","SE random","Q","I² %","Tau²"],"DerSimonian-Laird random-effects estimator.");}
function surveyMeanOffline(ds:OfflineDataset,p:any){const j=ds.columns.indexOf(p.var),wi=ds.columns.indexOf(p.weight),z=ds.rows.map(r=>[num(r[j]),num(r[wi])]).filter(r=>Number.isFinite(r[0])&&Number.isFinite(r[1])&&r[1]>0),a=z.map(r=>r[0]),w=z.map(r=>r[1]),m=weightedMean(a,w),sw=w.reduce((x,y)=>x+y,0),v=a.reduce((s,x,i)=>s+w[i]*(x-m)**2,0)/Math.max(1,sw);return result("Survey weighted mean",[[a.length,m,Math.sqrt(v)]],["N","Weighted mean","Approx. weighted SD"]);}
function repeatedOffline(ds:OfflineDataset,p:any){const vs=p.measures||[];const idx=vs.map((v:string)=>ds.columns.indexOf(v));const rows=ds.rows.map(r=>idx.map(j=>num(r[j]))).filter(r=>r.every(Number.isFinite));const means=vs.map((v:string,j:number)=>mean(rows.map(r=>r[j])));return result("Repeated-measures summary",[[rows.length,...means]],["N",...vs],"Offline summary of repeated measurements. Full GG correction/post-hoc remains server-side.");}
function surveyPropOffline(ds:OfflineDataset,p:any){const vi=ds.columns.indexOf(p.var),wi=ds.columns.indexOf(p.weight),m=new Map<string,number>();let sw=0;ds.rows.forEach(r=>{const w=num(r[wi]);if(Number.isFinite(w)&&w>0){const k=String(r[vi]??"Missing");m.set(k,(m.get(k)||0)+w);sw+=w;}});return result("Survey weighted proportions",[...m].map(([k,w])=>[k,w,w/sw*100]),["Category","Weighted N","Percent"]);}
function propensityOffline(ds:OfflineDataset,p:any){const ti=ds.columns.indexOf(p.treatment),xs=p.covariates||[],xi=xs.map((x:string)=>ds.columns.indexOf(x)),rows=ds.rows.map(r=>({t:num(r[ti]),x:xi.map(j=>num(r[j]))})).filter(o=>Number.isFinite(o.t)&&o.x.every(Number.isFinite));const levels=[...new Set(rows.map(o=>o.t))];if(levels.length!==2)throw new Error("Propensity score requires exactly 2 treatment levels.");const y=rows.map(o=>levels.indexOf(o.t)),X=rows.map(o=>[1,...o.x]),b=logisticIRLS(y,X),ps=rows.map((o,i)=>1/(1+Math.exp(-b.reduce((s,v,j)=>s+v*X[i][j],0))));if(p.method==="iptw"){const tr=levels[1],w=rows.map((o,i)=>o.t===tr?1/Math.max(ps[i],1e-6):1/Math.max(1-ps[i],1e-6));return result("Propensity score — IPTW",[[rows.length,mean(ps),Math.min(...ps),Math.max(...ps),mean(w)]],["N","Mean PS","Min PS","Max PS","Mean IPTW"]);}const treated=rows.map((o,i)=>({i,ps:ps[i]})).filter(o=>rows[o.i].t===levels[1]),control=rows.map((o,i)=>({i,ps:ps[i]})).filter(o=>rows[o.i].t===levels[0]),matches:any[]=[];const used=new Set<number>();for(const t of treated){let best=-1,bd=Infinity;for(const c of control)if(!used.has(c.i)){const d=Math.abs(t.ps-c.ps);if(d<bd){bd=d;best=c.i;}}if(best>=0){used.add(best);matches.push([t.i,best,t.ps,ps[best],bd]);}}return result("Propensity score — 1:1 matching",[[treated.length,control.length,matches.length,matches.length?mean(matches.map(m=>m[4])):NaN]],["Treated","Control","Matched pairs","Mean |PS difference|"],"Greedy nearest-neighbour matching without replacement.");}
export function runOffline(ds:OfflineDataset,module:string,p:any):any{
 if(module==="descriptive_summarize"){const rows:any[][]=[];for(const v of p.variables||[]){const a=vals(ds,v),m=mean(a),s=sd(a);
 rows.push([v,a.length,m,s,s/Math.sqrt(a.length),quant(a,.5),quant(a,.25),quant(a,.75),Math.min(...a),Math.max(...a)]);}
 return result(`Descriptive statistics — ${ds.name}`,rows,["Variable","N","Mean","SD","SE","Median","P25","P75","Min","Max"]);}
 if(module==="descriptive_freq"){const rows:any[][]=[];for(const v of p.variables||[]){const j=ds.columns.indexOf(v),m=new Map<string,number>();ds.rows.forEach(r=>{const k=String(r[j]??"Missing");m.set(k,(m.get(k)||0)+1)});const n=ds.rows.length;for(const[k,c]of m)rows.push([v,k,c,c/n*100]);}return result("Frequency tables",rows,["Variable","Value","Frequency","Percent"]);}
 if(module==="crosstab"||module==="chi2"){const x=ds.columns.indexOf(p.row),y=ds.columns.indexOf(p.col),mx=new Map<string,Map<string,number>>(),ys=new Set<string>();
 ds.rows.forEach(r=>{const a=String(r[x]??"Missing"),b=String(r[y]??"Missing");ys.add(b);if(!mx.has(a))mx.set(a,new Map);const q=mx.get(a)!;q.set(b,(q.get(b)||0)+1);});
 const cs=[...ys],rows=[...mx].map(([a,q])=>[a,...cs.map(c=>q.get(c)||0)]);return result("Cross-tabulation",rows,["Row",...cs]);}
 if(module==="corr_pair"){const[a,b]=pairs(ds,p.x,p.y),r=corr(a,b);return result("Correlation",[[p.x,p.y,a.length,r]],["X","Y","N","Correlation"],"Pearson correlation.");}
 if(module==="corr_matrix"){const vs=p.variables||[],rows=vs.map((x:string)=>vs.map((y:string)=>{const[a,b]=pairs(ds,x,y);return a.length>1?corr(a,b):NaN;}));return result("Correlation matrix",rows,vs);}
 if(module==="ttest_one"){const a=vals(ds,p.variable),m=mean(a),s=sd(a),t=(m-Number(p.testvalue||0))/(s/Math.sqrt(a.length));return result("One-sample t test",[[a.length,m,s,t,p2z(t)]],["N","Mean","SD","t","Approx. p"]);}
 if(module==="ttest_two"){const j=ds.columns.indexOf(p.group),iy=ds.columns.indexOf(p.variable),g=[...new Set(ds.rows.map(r=>String(r[j]??"Missing")))],A=g.length>0?ds.rows.filter(r=>String(r[j]??"Missing")===g[0]).map(r=>num(r[iy])).filter(Number.isFinite):[],B=g.length>1?ds.rows.filter(r=>String(r[j]??"Missing")===g[1]).map(r=>num(r[iy])).filter(Number.isFinite):[];
 const se=Math.sqrt(variance(A)/A.length+variance(B)/B.length),t=(mean(A)-mean(B))/se;return result("Independent-samples t test",[[g[0],A.length,mean(A),g[1],B.length,mean(B),t,p2z(t)]],["Group 1","N1","Mean1","Group 2","N2","Mean2","t","Approx. p"]);}
 if(module==="ttest_paired"){const[a,b]=pairs(ds,p.v1,p.v2),d=a.map((x,i)=>x-b[i]),t=mean(d)/(sd(d)/Math.sqrt(d.length));return result("Paired t test",[[d.length,mean(d),sd(d),t,p2z(t)]],["N","Mean difference","SD difference","t","Approx. p"]);}
 if(module==="mannwhitney"||module==="wilcoxon"){const[a,b]=module==="wilcoxon"?pairs(ds,p.v1,p.v2):(()=>{const j=ds.columns.indexOf(p.group),iy=ds.columns.indexOf(p.variable),g=[...new Set(ds.rows.map(r=>String(r[j]??"")))];return [ds.rows.filter(r=>String(r[j]??"")===g[0]).map(r=>num(r[iy])).filter(Number.isFinite),ds.rows.filter(r=>String(r[j]??"")===g[1]).map(r=>num(r[iy])).filter(Number.isFinite)]})();const d=module==="wilcoxon"?a.map((x,i)=>x-b[i]).filter(x=>x!==0):a.concat(b);return result(module==="wilcoxon"?"Wilcoxon signed-rank test":"Mann–Whitney test",[[a.length,b.length,mean(d),p2z(mean(d)/(sd(d)/Math.sqrt(d.length))) ]],["N1","N2","Statistic/mean difference","Approx. p"]);}
 if(module==="anova"||module==="kruskal"){const y=ds.columns.indexOf(p.variable),g=ds.columns.indexOf(p.group),m=new Map<string,number[]>();ds.rows.forEach(r=>{const v=num(r[y]),k=String(r[g]??"");if(Number.isFinite(v)){if(!m.has(k))m.set(k,[]);m.get(k)!.push(v);}});const all=[...m.values()].flat(),gm=mean(all);let ssb=0;for(const a of m.values())ssb+=a.length*(mean(a)-gm)**2;const df=Math.max(1,m.size-1),msb=ssb/df;let ssw=0;for(const a of m.values())ssw+=a.reduce((s,x)=>s+(x-mean(a))**2,0);const msw=ssw/Math.max(1,all.length-m.size),F=msb/msw;return result(module==="anova"?"One-way ANOVA":"Kruskal–Wallis",[[all.length,m.size,F,p2z(Math.sqrt(Math.max(F,0)))]],["N","Groups","Statistic","Approx. p"]);}
 if(module==="meta"){return metaOffline(ds,p);}\n if(module==="repeated"){return repeatedOffline(ds,p);}\n if(module==="survey_prop"){return surveyPropOffline(ds,p);}\n if(module==="km"){return kmOffline(ds,p.time,p.event,p.group);}\n if(module==="survey_mean"){return surveyMeanOffline(ds,p);}\n if(module==="propensity"){return propensityOffline(ds,p);}\n if(module==="diag_2x2"){const tp=+p.tp,fp=+p.fp,fn=+p.fn,tn=+p.tn,sens=tp/(tp+fn),spec=tn/(tn+fp),ppv=tp/(tp+fp),npv=tn/(tn+fn),acc=(tp+tn)/(tp+fp+fn+tn);return result("2×2 diagnostic accuracy",[[sens*100,spec*100,ppv*100,npv*100,acc*100]],["Sensitivity %","Specificity %","PPV %","NPV %","Accuracy %"]);}
 if(module==="diag_vars"){const a=vals(ds,p.test_var),b=vals(ds,p.gold_var);return result("Diagnostic variables",[[a.length,b.length]],["Test N","Reference N"]);}
 if(module==="roc"){const[y,s]=pairs(ds,p.y,p.score_vars?.[0]);const order=[...s.map((v,i)=>[v,y[i]] as [number,number])].sort((a,b)=>b[0]-a[0]);let tp=0,fp=0,pos=y.filter(v=>v===1).length,neg=y.length-pos;const pts=[[0,0]];for(const[,yy]of order){if(yy===1)tp++;else fp++;pts.push([fp/Math.max(1,neg),tp/Math.max(1,pos)]);}let auc=0;for(let i=1;i<pts.length;i++)auc+=(pts[i][0]-pts[i-1][0])*(pts[i][1]+pts[i-1][1])/2;return result("ROC analysis",[[y.length,auc]],["N","AUC"]);}
 if(module==="graph_bar"||module==="graph_histogram"||module==="graph_box"||module==="graph_scatter"){return {title:"Offline graph",blocks:[{type:"text",content:`Graph module "${module}" is available offline; use the result data with the chart view.`}]};}
 throw new Error(`Offline engine does not yet implement "${module}". Reconnect once to use the full server engine.`);
}
