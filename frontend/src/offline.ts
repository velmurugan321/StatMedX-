import * as XLSX from "xlsx";
/* StatMedX offline runtime: CSV/local datasets + browser-side core statistics.
   No network, server, or external runtime is required for these modules. */
export type OfflineDataset = {
  id: number; name: string; n_rows: number; n_cols: number; source_format: string;
  columns: string[]; rows: any[]; description?: string; remote_dataset_id?: number;
};

const DB = "statmedx-offline";
const STORE = "datasets";
const RESULTS = "results";

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const r = indexedDB.open(DB, 2);
    r.onupgradeneeded = () => {
      if (!r.result.objectStoreNames.contains(STORE)) r.result.createObjectStore(STORE, { keyPath: "id" });
      if (!r.result.objectStoreNames.contains(RESULTS)) r.result.createObjectStore(RESULTS, { keyPath: "id" });
    };
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

export async function deleteOfflineDataset(id: number): Promise<void> {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction([STORE, RESULTS], "readwrite");
    tx.objectStore(STORE).delete(id);
    const req = tx.objectStore(RESULTS).getAll();
    req.onsuccess = () => req.result.filter((r: OfflineResult) => r.dataset_id === id).forEach((r: OfflineResult) => tx.objectStore(RESULTS).delete(r.id));
    tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error);
  });
  db.close();
}

function newLocalId() { return -(Date.now() * 1000 + Math.floor(Math.random() * 1000)); }

export type OfflineResult = { id: number; dataset_id: number; module: string; title: string; result: any; created_at: string };

export function assessDataQuality(columns:string[],rows:any[][]){
 const missingValue=(v:any)=>v===null||v===undefined||v===""||(typeof v==="number"&&!Number.isFinite(v));
 const variables=columns.map((name,j)=>{
  const values=rows.map(r=>r[j]).filter(v=>!missingValue(v));
  const types=new Set(values.map(v=>typeof v==="number"?"numeric":typeof v==="boolean"?"boolean":v instanceof Date?"date":"text"));
  const numeric=values.filter(v=>typeof v==="number"&&Number.isFinite(v)).map(Number).sort((a,b)=>a-b);
  const quantile=(p:number)=>{if(!numeric.length)return NaN;const at=(numeric.length-1)*p,lo=Math.floor(at),f=at-lo;return numeric[lo]+f*((numeric[lo+1]??numeric[lo])-numeric[lo]);};
  const q1=quantile(.25),q3=quantile(.75),iqr=q3-q1;
  const outliers=numeric.filter(v=>v<q1-1.5*iqr||v>q3+1.5*iqr).length;
  const missing=rows.length-values.length;
  return {name,missing,missingPercent:rows.length?missing*100/rows.length:0,unique:new Set(values.map(v=>String(v))).size,outliers,mixedTypes:types.size>1,constant:values.length>0&&new Set(values.map(v=>String(v))).size===1};
 });
 const seen=new Set<string>();let duplicateRows=0;
 rows.forEach(row=>{const key=JSON.stringify(row);if(seen.has(key))duplicateRows++;else seen.add(key);});
 return {rowCount:rows.length,columnCount:columns.length,missingCells:variables.reduce((sum,v)=>sum+v.missing,0),duplicateRows,variables};
}

export async function saveOfflineResult(value: Omit<OfflineResult, "id" | "created_at">): Promise<OfflineResult> {
  const db = await openDb();
  const item: OfflineResult = { ...value, id: -(Date.now() * 1000 + Math.floor(Math.random() * 1000)), created_at: new Date().toISOString() };
  await new Promise<void>((resolve, reject) => {
    const req = db.transaction(RESULTS, "readwrite").objectStore(RESULTS).put(item);
    req.onsuccess = () => resolve(); req.onerror = () => reject(req.error);
  });
  db.close();
  return item;
}
export async function listOfflineResults(datasetId?: number): Promise<OfflineResult[]> {
  const db = await openDb();
  const items = await new Promise<OfflineResult[]>((resolve, reject) => {
    const req = db.transaction(RESULTS).objectStore(RESULTS).getAll();
    req.onsuccess = () => resolve(req.result || []); req.onerror = () => reject(req.error);
  });
  db.close();
  return items.filter(x => datasetId === undefined || x.dataset_id === datasetId).sort((a,b) => b.created_at.localeCompare(a.created_at));
}
export async function getOfflineResult(id: number): Promise<OfflineResult | null> {
  const db = await openDb();
  const item = await new Promise<OfflineResult | null>((resolve, reject) => {
    const req = db.transaction(RESULTS).objectStore(RESULTS).get(id);
    req.onsuccess = () => resolve(req.result ?? null); req.onerror = () => reject(req.error);
  });
  db.close();
  return item;
}
export async function updateOfflineCell(id: number, row: number, column: string, value: any): Promise<OfflineDataset> {
  const ds = await getOfflineDataset(id);
  if (!ds) throw new Error("Offline dataset not found.");
  const col = ds.columns.indexOf(column);
  if (row < 0 || row >= ds.rows.length || col < 0) throw new Error("The selected cell no longer exists.");
  const trimmed = typeof value === "string" ? value.trim() : value;
  const parsed = trimmed === "" || trimmed === null ? null : Number.isFinite(Number(trimmed)) ? Number(trimmed) : String(trimmed);
  ds.rows[row][col] = parsed;
  await saveOfflineDataset(ds);
  return ds;
}
export async function deleteOfflineRow(id: number, row: number): Promise<OfflineDataset> {
  const ds = await getOfflineDataset(id);
  if (!ds) throw new Error("Offline dataset not found.");
  if (row < 0 || row >= ds.rows.length) throw new Error("The selected row no longer exists.");
  ds.rows.splice(row, 1); ds.n_rows = ds.rows.length;
  await saveOfflineDataset(ds);
  return ds;
}

export async function parseStatFile(file: File, name?: string): Promise<OfflineDataset> {
  const ext = /\.([^.]+)$/.exec(file.name)?.[1]?.toLowerCase();
  if (ext === "dta") throw new Error("Offline Stata (.dta) import is not available yet. Please use CSV/Excel offline or reconnect for server import.");
  if (ext === "sav") throw new Error("Offline SPSS (.sav) import is not available yet. Please use CSV/Excel offline or reconnect for server import.");
  throw new Error("Unsupported statistical file format.");
}

export function readFileWithProgress(file: File, onProgress?: (percent:number)=>void): Promise<ArrayBuffer> {
 return new Promise((resolve,reject)=>{
  const reader=new FileReader();
  reader.onprogress=e=>{ if(e.lengthComputable) onProgress?.(Math.round((e.loaded/e.total)*100)); };
  reader.onload=()=>{ onProgress?.(100); resolve(reader.result as ArrayBuffer); };
  reader.onerror=()=>reject(reader.error||new Error("Unable to read file."));
  reader.readAsArrayBuffer(file);
 });
}

export function parseExcelWorkbook(buffer: ArrayBuffer | Uint8Array, name: string): OfflineDataset[] {
 const wb=XLSX.read(buffer,{type:"array",cellDates:false});
 const datasets:OfflineDataset[]=[];
 for(const sheetName of wb.SheetNames){
  const ws=wb.Sheets[sheetName];
  const rows:any[][]=XLSX.utils.sheet_to_json(ws,{header:1,defval:""});
  if(!rows.length)continue;
  const rawHeader=rows[0].map((v:any,i:number)=>String(v??"").trim()||`V${i+1}`);
  const used=new Set<string>();
  const header=rawHeader.map((value:string)=>{let candidate=value,suffix=2;while(used.has(candidate))candidate=`${value}_${suffix++}`;used.add(candidate);return candidate;});
  const data=rows.slice(1).filter(r=>r.some((v:any)=>String(v??"").trim()!=="")).map(r=>header.map((_,i)=>r[i]??""));
  if(!data.length)continue;
  datasets.push({id:newLocalId(),name:wb.SheetNames.length>1?`${name} — ${sheetName}`:name,n_rows:data.length,n_cols:header.length,columns:header,rows:data,source_format:"xlsx",description:`Excel sheet · ${sheetName}`});
 }
 if(!datasets.length)throw new Error("The Excel workbook has no non-empty sheets with a header and data rows.");
 return datasets;
}

export async function parseExcelFile(file: File, name?: string, onProgress?: (percent:number)=>void): Promise<OfflineDataset[]> {
 const buf=await readFileWithProgress(file,onProgress);
 return parseExcelWorkbook(buf,name||file.name.replace(/\.[^.]+$/,""));
}

function tokenizeExpression(expression:string):string[]{
 const tokens=expression.match(/\s*(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?|\s*(?:"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*')|\s*[A-Za-z_][A-Za-z0-9_]*|\s*(?:===|!==|>=|<=|==|!=|&&|\|\||\*\*|[()+\-*/%><!&|])/g)||[];
 if(tokens.join("").replace(/\s/g,"")!==expression.replace(/\s/g,""))throw new Error("Expression has unsupported characters or syntax.");
 return tokens.map(t=>t.trim());
}
function evaluateExpression(expression:string,row:any[],columns:string[]):any{
 const tokens=tokenizeExpression(expression);let i=0;
 const primary=():any=>{const t=tokens[i++];if(t===undefined)throw new Error("Incomplete expression.");if(t==="("){const v=or();if(tokens[i++]!==")")throw new Error("Missing closing parenthesis.");return v;}if(t==="!")return !primary();if(t==="-")return -Number(primary());if(t==="+")return Number(primary());if(/^\d/.test(t)||/^\.\d/.test(t))return Number(t);if(t.startsWith("\"")||t.startsWith("'"))return t[0]==='"'?JSON.parse(t):t.slice(1,-1).replace(/\\'/g,"'").replace(/\\\\/g,"\\");if(t.toLowerCase()==="true")return true;if(t.toLowerCase()==="false")return false;const col=columns.indexOf(t);if(col<0)throw new Error(`Unknown variable: ${t}`);const v=row[col];return v===null||v===""?NaN:v;};
 const chain=(next:()=>any,ops:string[],apply:(a:any,op:string,b:any)=>any):any=>{let a=next();while(ops.includes(tokens[i])){const op=tokens[i++];a=apply(a,op,next());}return a;};
 const power=()=>{const a=primary();if(tokens[i]==="**"){i++;return Number(a)**Number(power());}return a;};
 const mult=()=>chain(power,["*","/","%"],(a,o,b)=>o==="*"?Number(a)*Number(b):o==="/"?Number(a)/Number(b):Number(a)%Number(b));
 const add=()=>chain(mult,["+","-"],(a,o,b)=>o==="+"?Number(a)+Number(b):Number(a)-Number(b));
 const compare=()=>chain(add,[">",">=","<","<=","==","===","!=","!=="],(a,o,b)=>{if(o==="=="||o==="===")return a===b||String(a)===String(b);if(o==="!="||o==="!==")return !(a===b||String(a)===String(b));return o===">"?Number(a)>Number(b):o===">="?Number(a)>=Number(b):o==="<"?Number(a)<Number(b):Number(a)<=Number(b);});
 const and=()=>chain(compare,["&","&&"],(a,_o,b)=>Boolean(a)&&Boolean(b));
 const or=()=>chain(and,["|","||"],(a,_o,b)=>Boolean(a)||Boolean(b));
 const result=or();if(i!==tokens.length)throw new Error(`Unexpected token: ${tokens[i]}`);return result;
}
export function runOfflineTransform(ds:OfflineDataset,op:string,params:any={}):{dataset:OfflineDataset;message:string;duplicates?:any[][]}{
 const next:OfflineDataset={...ds,columns:[...ds.columns],rows:ds.rows.map(r=>[...r])};
 const colIndex=(name:string)=>{const i=next.columns.indexOf(name);if(i<0)throw new Error(`Unknown variable: ${name}`);return i;};
 if(op==="generate"||op==="add_variable"){
  const name=String(params.name||"").trim(),expr=String(params.expression||"").trim();if(!name||!expr)throw new Error("Enter a variable name and expression.");if(next.columns.includes(name))throw new Error(`Variable already exists: ${name}`);
  const values=next.rows.map(row=>{const v=evaluateExpression(expr,row,next.columns);return typeof v==="number"&&!Number.isFinite(v)?null:v;});next.columns.push(name);next.rows=next.rows.map((row,i)=>[...row,values[i]]);next.n_cols=next.columns.length;
  return {dataset:next,message:`Created ${name} from ${expr}.`};
 }
 if(op==="recode"){
  const j=colIndex(params.variable),target=params.generate_as?String(params.generate_as).trim():params.variable;if(params.generate_as&&next.columns.includes(target))throw new Error(`Variable already exists: ${target}`);
  const source=next.rows.map(r=>r[j]);const values=source.map(value=>{for(const rule of params.rules||[]){const old=String(rule.old??"").trim(),raw=String(value??"");if(!old)continue;let match=false;const range=/^(-?\d+(?:\.\d+)?)\s*\/\s*(-?\d+(?:\.\d+)?)$/.exec(old);if(range){const v=Number(value);match=Number.isFinite(v)&&v>=Number(range[1])&&v<=Number(range[2]);}else if(old.toLowerCase()==="missing")match=value===null||value==="";else match=raw===old||(Number.isFinite(Number(old))&&Number(value)===Number(old));if(match){const v=String(rule.new??"");return v===""?null:Number.isFinite(Number(v))?Number(v):v;}}return value;});
  if(params.generate_as){next.columns.push(target);next.rows=next.rows.map((r,i)=>[...r,values[i]]);next.n_cols=next.columns.length;}else next.rows=next.rows.map((r,i)=>r.map((v,k)=>k===j?values[i]:v));
  return {dataset:next,message:`Recoded ${params.variable}${params.generate_as?` into ${target}`:""}.`};
 }
 if(op==="filter"){
  const condition=String(params.condition||"").trim();if(!condition)throw new Error("Enter a filter condition.");next.rows=next.rows.filter(r=>Boolean(evaluateExpression(condition,r,next.columns)));next.n_rows=next.rows.length;return {dataset:next,message:`Kept ${next.n_rows.toLocaleString()} matching rows.`};
 }
 if(op==="sort"){
  const keys=(params.variables||[]).filter((v:string)=>next.columns.includes(v));if(!keys.length)throw new Error("Select at least one variable to sort by.");const indices=keys.map(colIndex);next.rows=next.rows.map((row,index)=>({row,index})).sort((a,b)=>{for(const j of indices){const av=a.row[j],bv=b.row[j];const cmp=av==null? (bv==null?0:1):bv==null?-1:typeof av==="number"&&typeof bv==="number"?av-bv:String(av).localeCompare(String(bv),undefined,{numeric:true,sensitivity:"base"});if(cmp)return (params.ascending===false?-1:1)*cmp;}return a.index-b.index;}).map(x=>x.row);return {dataset:next,message:`Sorted rows by ${keys.join(", ")}.`};
 }
 if(op==="add_row"){
  next.rows.push(next.columns.map(()=>null));next.n_rows=next.rows.length;return {dataset:next,message:"Added an empty row."};
 }
 if(op==="impute_missing"){
  const j=colIndex(params.name);const values=next.rows.map(r=>r[j]).filter(v=>v!==null&&v!==""&&Number.isFinite(Number(v))).map(Number);if(!values.length)throw new Error("Selected variable has no numeric values to impute from.");const method=params.method||"mean";const sorted=[...values].sort((a,b)=>a-b);const fill=method==="zero"?0:method==="median"?(sorted.length%2?sorted[(sorted.length-1)/2]:(sorted[sorted.length/2-1]+sorted[sorted.length/2])/2):values.reduce((a,b)=>a+b,0)/values.length;if(method!=="mean"&&method!=="median"&&method!=="zero")throw new Error("Choose mean, median, or zero imputation.");let count=0;next.rows=next.rows.map(r=>{if(r[j]===null||r[j]===""){count++;const copy=[...r];copy[j]=fill;return copy;}return r;});return {dataset:next,message:`Filled ${count} missing values in ${params.name} with ${fill}.`};
 }
 if(op==="dedupe"){
  const seen=new Set<string>(),duplicates:any[][]=[];next.rows.forEach(r=>{const k=JSON.stringify(r);if(seen.has(k))duplicates.push(r);else seen.add(k);});if(params.mode==="report")return {dataset:next,message:`Found ${duplicates.length} duplicate rows.`,duplicates};next.rows=next.rows.filter((r,i)=>{const k=JSON.stringify(r);if(seen.has(k)){seen.delete(k);return true;}return false;});next.n_rows=next.rows.length;return {dataset:next,message:`Removed ${duplicates.length} duplicate rows.`};
 }
 if(op==="drop_missing"){
  const j=params.variable?colIndex(params.variable):-1,before=next.rows.length;next.rows=next.rows.filter(r=>j<0?r.every(v=>v!==null&&v!==""):r[j]!==null&&r[j]!=="");next.n_rows=next.rows.length;return {dataset:next,message:`Removed ${before-next.n_rows} rows with missing values${params.variable?` in ${params.variable}`:""}.`};
 }
 throw new Error(`Offline data cleaning does not support ${op} yet.`);
}

export function parseDelimited(text: string, name: string, sep?: string): OfflineDataset {
  const source = text.replace(/^\uFEFF/, "");
  if (!source.trim()) throw new Error("The file is empty.");
  const firstLine = source.split(/\r?\n/, 1)[0];
  const delimiter = sep || (firstLine.includes("\t") ? "\t" : firstLine.includes(",") ? "," : /\s+/.test(firstLine) ? " " : ",");
  const records: string[][] = [];
  let row: string[] = [], field = "", quoted = false;
  if (delimiter === " ") {
    for (const line of source.split(/\r?\n/).filter(x => x.trim() !== "")) records.push(line.trim().split(/\s+/));
  } else {
    for (let i = 0; i < source.length; i++) {
      const ch = source[i];
      if (ch === '"') {
        if (quoted && source[i + 1] === '"') { field += '"'; i++; }
        else quoted = !quoted;
      } else if (ch === delimiter && !quoted) { row.push(field); field = ""; }
      else if ((ch === "\n" || ch === "\r") && !quoted) {
        if (ch === "\r" && source[i + 1] === "\n") i++;
        row.push(field); field = "";
        if (row.some(v => v.trim() !== "")) records.push(row);
        row = [];
      } else field += ch;
    }
    if (quoted) throw new Error("The delimited file contains an unclosed quoted value.");
    if (field.length || row.length) { row.push(field); if (row.some(v => v.trim() !== "")) records.push(row); }
  }
  if (!records.length) throw new Error("The file has no header row.");
  const rawColumns = records[0].map((x,i)=>x.trim() || `var_${i+1}`);
  const used = new Set<string>();
  const columns = rawColumns.map((value,i)=>{let candidate=value,suffix=2;while(used.has(candidate))candidate=`${value}_${suffix++}`;used.add(candidate);return candidate;});
  const rows = records.slice(1).map(r => columns.map((_,i) => {
    const s=(r[i]??"").trim(); if(s==="") return null;
    const n=Number(s); return Number.isFinite(n) ? n : s;
  }));
  return {id: newLocalId(), name, n_rows: rows.length, n_cols: columns.length, source_format:"csv",
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
function wilson(success:number,total:number){if(total<=0)return[NaN,NaN];const z=1.959963984540054,p=success/total,d=1+z*z/total,c=(p+z*z/(2*total))/d,h=z*Math.sqrt(p*(1-p)/total+z*z/(4*total*total))/d;return[Math.max(0,c-h),Math.min(1,c+h)];}
function logGamma(z:number){const c=[676.5203681218851,-1259.1392167224028,771.32342877765313,-176.61502916214059,12.507343278686905,-0.13857109526572012,9.9843695780195716e-6,1.5056327351493116e-7];if(z<0.5)return Math.log(Math.PI)-Math.log(Math.sin(Math.PI*z))-logGamma(1-z);let x=0.99999999999980993;z-=1;for(let i=0;i<c.length;i++)x+=c[i]/(z+i+1);const t=z+c.length-0.5;return 0.9189385332046727+(z+0.5)*Math.log(t)-t+Math.log(x);}
function betaCf(a:number,b:number,x:number){const max=200,eps=3e-14,fp=1e-300;const qab=a+b,qap=a+1,qam=a-1;let c=1,d=1-qab*x/qap;if(Math.abs(d)<fp)d=fp;d=1/d;let h=d;for(let m=1;m<=max;m++){const m2=2*m;let aa=m*(b-m)*x/((qam+m2)*(a+m2));d=1+aa*d;if(Math.abs(d)<fp)d=fp;c=1+aa/c;if(Math.abs(c)<fp)c=fp;d=1/d;h*=d*c;aa=-(a+m)*(qab+m)*x/((a+m2)*(qap+m2));d=1+aa*d;if(Math.abs(d)<fp)d=fp;c=1+aa/c;if(Math.abs(c)<fp)c=fp;d=1/d;const del=d*c;h*=del;if(Math.abs(del-1)<eps)break;}return h;}
function betaI(x:number,a:number,b:number){if(x<=0)return 0;if(x>=1)return 1;const bt=Math.exp(logGamma(a+b)-logGamma(a)-logGamma(b)+a*Math.log(x)+b*Math.log1p(-x));return x<(a+1)/(a+b+2)?bt*betaCf(a,b,x)/a:1-bt*betaCf(b,a,1-x)/b;}
function tP(t:number,df:number){if(!(df>0)||Number.isNaN(t))return NaN;if(!Number.isFinite(t))return 0;return betaI(df/(df+t*t),df/2,0.5);}
function tCritical(probability:number,df:number){let lo=0,hi=1;const cdf=(t:number)=>1-tP(t,df)/2;while(cdf(hi)<probability&&hi<1e6)hi*=2;for(let i=0;i<80;i++){const mid=(lo+hi)/2;if(cdf(mid)<probability)lo=mid;else hi=mid;}return(lo+hi)/2;}
function fP(f:number,d1:number,d2:number){if(!(d1>0&&d2>0)||f<0||Number.isNaN(f))return NaN;if(!Number.isFinite(f))return 0;return betaI(d2/(d2+d1*f),d2/2,d1/2);}
function gammaQ(a:number,x:number){if(!(a>0)||x<0)return NaN;if(x===0)return 1;const gln=logGamma(a);if(x<a+1){let sum=1/a,del=sum,ap=a;for(let n=0;n<1000;n++){ap++;del*=x/ap;sum+=del;if(Math.abs(del)<Math.abs(sum)*1e-14)break;}return Math.max(0,Math.min(1,1-sum*Math.exp(-x+a*Math.log(x)-gln)));}let b=x+1-a,c=1e300,d=1/b,h=d;for(let i=1;i<1000;i++){const an=-i*(i-a);b+=2;d=an*d+b;if(Math.abs(d)<1e-300)d=1e-300;c=b+an/c;if(Math.abs(c)<1e-300)c=1e-300;d=1/d;const del=d*c;h*=del;if(Math.abs(del-1)<1e-14)break;}return Math.max(0,Math.min(1,Math.exp(-x+a*Math.log(x)-gln)*h));}
function chiP(x:number,df:number){return x<0||df<=0?NaN:gammaQ(df/2,x/2);}
function averageRanks(values:number[]){const order=values.map((v,i)=>({v,i})).sort((a,b)=>a.v-b.v),ranks=Array(values.length).fill(0),ties:number[]=[];for(let i=0;i<order.length;){let j=i+1;while(j<order.length&&order[j].v===order[i].v)j++;const rank=(i+1+j)/2;for(let k=i;k<j;k++)ranks[order[k].i]=rank;if(j-i>1)ties.push(j-i);i=j;}return{ranks,ties};}
function logChoose(n:number,k:number){return logGamma(n+1)-logGamma(k+1)-logGamma(n-k+1);}
function fisher2x2(a:number,b:number,c:number,d:number){const r1=a+b,r2=c+d,c1=a+c,n=r1+r2,lo=Math.max(0,r1+c1-n),hi=Math.min(r1,c1),lp=(x:number)=>logChoose(r1,x)+logChoose(r2,c1-x)-logChoose(n,c1),obs=lp(a);let p=0;for(let x=lo;x<=hi;x++)if(lp(x)<=obs+1e-12)p+=Math.exp(lp(x));return Math.min(1,p);}
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
function ols(y:number[],X:number[][]){if(!y.length||X.length!==y.length)throw new Error("No complete observations.");return matVec(inv(matMul(transpose(X),X)),matVec(transpose(X),y));}
function logisticIRLS(y:number[],X:number[][]){let b=Array(X[0].length).fill(0);for(let it=0;it<50;it++){const p=X.map(r=>1/(1+Math.exp(-Math.max(-30,Math.min(30,r.reduce((s,x,j)=>s+x*b[j],0))))));const W=X.map((r,i)=>r.map(x=>x*Math.max(1e-8,p[i]*(1-p[i]))));const Xt=transpose(X),A=matMul(Xt,W),z=y.map((v,i)=>{const eta=Math.log(p[i]/(1-p[i]));return eta+(v-p[i])/Math.max(1e-8,p[i]*(1-p[i]));});const nb=matVec(inv(A),matVec(Xt,z));if(nb.every((v,j)=>Math.abs(v-b[j])<1e-7)){b=nb;break;}b=nb;}return b;}
function kmOffline(ds:OfflineDataset,timeCol:string,eventCol:string,groupCol?:string){const ti=ds.columns.indexOf(timeCol),ei=ds.columns.indexOf(eventCol),gi=groupCol?ds.columns.indexOf(groupCol):-1;const groups=gi<0?["All"]:[...new Set(ds.rows.map(r=>String(r[gi]??"Missing")))];const summaries:any[][]=[];for(const g of groups){const z=ds.rows.filter(r=>gi<0||String(r[gi]??"Missing")===g).map(r=>[num(r[ti]),num(r[ei])]).filter(r=>Number.isFinite(r[0])&&Number.isFinite(r[1]));let S=1,med:any=null;const ev=[...new Set(z.filter(r=>r[1]>0).map(r=>r[0]))].sort((a,b)=>a-b);for(const t of ev){const risk=z.filter(r=>r[0]>=t).length,d=z.filter(r=>r[0]===t&&r[1]>0).length;if(risk)S*=1-d/risk;if(med===null&&S<=.5)med=t;}summaries.push([g,z.length,z.filter(r=>r[1]>0).length,med===null?"Not reached":med]);}return result("Kaplan-Meier",summaries,["Group","N","Events","Median survival"]);}
function metaOffline(ds:OfflineDataset,p:any){const ei=ds.columns.indexOf(p.effect_col),si=ds.columns.indexOf(p.se_col),wi=p.study_col?ds.columns.indexOf(p.study_col):-1;const z=ds.rows.map((r,i)=>({e:num(r[ei]),s:num(r[si]),study:wi>=0?String(r[wi]):"Study "+(i+1)})).filter(x=>Number.isFinite(x.e)&&Number.isFinite(x.s)&&x.s>0);if(z.length<2)throw new Error("Meta-analysis needs at least 2 studies.");const w=z.map(x=>1/x.s**2),sw=w.reduce((a,b)=>a+b,0),ef=z.reduce((a,x,i)=>a+w[i]*x.e,0)/sw,seF=Math.sqrt(1/sw),Q=z.reduce((a,x,i)=>a+w[i]*(x.e-ef)**2,0),df=z.length-1,C=sw-w.reduce((a,x)=>a+x*x,0)/sw,tau=Math.max(0,(Q-df)/C),wr=z.map(x=>1/(x.s*x.s+tau)),swr=wr.reduce((a,b)=>a+b,0),er=z.reduce((a,x,i)=>a+wr[i]*x.e,0)/swr,seR=Math.sqrt(1/swr),I2=Q>0?Math.max(0,(Q-df)/Q)*100:0;return result("Meta-analysis",[[z.length,ef,seF,er,seR,Q,I2,tau]],["Studies","Fixed effect","SE fixed","Random effect","SE random","Q","I² %","Tau²"],"DerSimonian-Laird random-effects estimator.");}
function surveyMeanOffline(ds:OfflineDataset,p:any){const j=ds.columns.indexOf(p.var),wi=ds.columns.indexOf(p.weight),z=ds.rows.map(r=>[num(r[j]),num(r[wi])]).filter(r=>Number.isFinite(r[0])&&Number.isFinite(r[1])&&r[1]>0),a=z.map(r=>r[0]),w=z.map(r=>r[1]),m=weightedMean(a,w),sw=w.reduce((x,y)=>x+y,0),v=a.reduce((s,x,i)=>s+w[i]*(x-m)**2,0)/Math.max(1,sw);return result("Survey weighted mean",[[a.length,m,Math.sqrt(v)]],["N","Weighted mean","Approx. weighted SD"]);}
function repeatedOffline(ds:OfflineDataset,p:any){const vs=p.measures||[];const idx=vs.map((v:string)=>ds.columns.indexOf(v));const rows=ds.rows.map(r=>idx.map(j=>num(r[j]))).filter(r=>r.every(Number.isFinite));const means=vs.map((v:string,j:number)=>mean(rows.map(r=>r[j])));return result("Repeated-measures summary",[[rows.length,...means]],["N",...vs],"Offline summary of repeated measurements. Full GG correction/post-hoc remains server-side.");}
function surveyPropOffline(ds:OfflineDataset,p:any){const vi=ds.columns.indexOf(p.var),wi=ds.columns.indexOf(p.weight),m=new Map<string,number>();let sw=0;ds.rows.forEach(r=>{const w=num(r[wi]);if(Number.isFinite(w)&&w>0){const k=String(r[vi]??"Missing");m.set(k,(m.get(k)||0)+w);sw+=w;}});return result("Survey weighted proportions",[...m].map(([k,w])=>[k,w,w/sw*100]),["Category","Weighted N","Percent"]);}
function propensityOffline(ds:OfflineDataset,p:any){const ti=ds.columns.indexOf(p.treatment),xs=p.covariates||[],xi=xs.map((x:string)=>ds.columns.indexOf(x)),rows=ds.rows.map(r=>({t:num(r[ti]),x:xi.map(j=>num(r[j]))})).filter(o=>Number.isFinite(o.t)&&o.x.every(Number.isFinite));const levels=[...new Set(rows.map(o=>o.t))];if(levels.length!==2)throw new Error("Propensity score requires exactly 2 treatment levels.");const y=rows.map(o=>levels.indexOf(o.t)),X=rows.map(o=>[1,...o.x]),b=logisticIRLS(y,X),ps=rows.map((o,i)=>1/(1+Math.exp(-b.reduce((s,v,j)=>s+v*X[i][j],0))));if(p.method==="iptw"){const tr=levels[1],w=rows.map((o,i)=>o.t===tr?1/Math.max(ps[i],1e-6):1/Math.max(1-ps[i],1e-6));return result("Propensity score — IPTW",[[rows.length,mean(ps),Math.min(...ps),Math.max(...ps),mean(w)]],["N","Mean PS","Min PS","Max PS","Mean IPTW"]);}const treated=rows.map((o,i)=>({i,ps:ps[i]})).filter(o=>rows[o.i].t===levels[1]),control=rows.map((o,i)=>({i,ps:ps[i]})).filter(o=>rows[o.i].t===levels[0]),matches:any[]=[];const used=new Set<number>();for(const t of treated){let best=-1,bd=Infinity;for(const c of control)if(!used.has(c.i)){const d=Math.abs(t.ps-c.ps);if(d<bd){bd=d;best=c.i;}}if(best>=0){used.add(best);matches.push([t.i,best,t.ps,ps[best],bd]);}}return result("Propensity score — 1:1 matching",[[treated.length,control.length,matches.length,matches.length?mean(matches.map(m=>m[4])):NaN]],["Treated","Control","Matched pairs","Mean |PS difference|"],"Greedy nearest-neighbour matching without replacement.");}
function regressionFrame(ds:OfflineDataset,y:string,xs:string[]){const yi=ds.columns.indexOf(y),xi=xs.map(v=>ds.columns.indexOf(v));const rows=ds.rows.map(r=>[num(r[yi]),...xi.map(j=>num(r[j]))]).filter(r=>r.every(Number.isFinite));return rows;}
function logisticCore(y:number[],X:number[][]){return logisticIRLS(y,X);}
function regressionOffline(ds:OfflineDataset,module:string,p:any){
 const y=p.y,xs=p.xs||[],rows=regressionFrame(ds,y,xs);if(!rows.length)throw new Error("No complete numeric observations.");
 const Y=rows.map(r=>r[0]),X=rows.map(r=>[1,...r.slice(1)]);
 if(module!=="reg_linear")throw new Error("This regression model needs the validated analysis server and is not available in offline mode.");
 if(module==="reg_linear"){const df=Y.length-X[0].length;if(df<=0)throw new Error("Linear regression needs more complete observations than fitted parameters.");const b=ols(Y,X),fit=matVec(X,b),res=Y.map((v,i)=>v-fit[i]),s2=res.reduce((a,v)=>a+v*v,0)/df,V=matMul(inv(matMul(transpose(X),X)),Array(X[0].length).fill(0).map((_,i)=>Array(X[0].length).fill(0).map((_,j)=>i===j?s2:0))),se=V.map((r,i)=>Math.sqrt(Math.max(0,r[i]))),crit=tCritical(.975,df),rows2=b.map((v,i)=>[i===0?"_cons":xs[i-1],v,se[i],se[i]?v/se[i]:NaN,se[i]?tP(v/se[i],df):NaN,[v-crit*se[i],v+crit*se[i]]]);const ym=mean(Y),sst=Y.reduce((a,v)=>a+(v-ym)**2,0),sse=res.reduce((a,v)=>a+v*v,0);return result("Linear regression — offline",rows2,["Variable","Coef.","SE","t","p","95% CI"],`N = ${Y.length}; residual df = ${df}; R² = ${sst?sprintf(sse, sst):"NA"}`);}
 if(module==="reg_logistic"){if(Y.some(v=>v!==0&&v!==1))throw new Error("Logistic outcome must be coded 0/1.");const b=logisticCore(Y,X);const ph=X.map(r=>1/(1+Math.exp(-r.reduce((a,v,i)=>a+v*b[i],0))));const z=Y.map((v,i)=>(v-ph[i])**2/Math.max(1e-8,ph[i]*(1-ph[i]))).reduce((a,v)=>a+v,0);return result("Logistic regression — offline",b.map((v,i)=>{const se=Math.sqrt(Math.max(1e-10,inv(matMul(transpose(X),X))[i][i]));return [i===0?"_cons":xs[i-1],Math.exp(v),se,v/se,p2z(v/se),[Math.exp(v-1.96*se),Math.exp(v+1.96*se)]]}),["Variable","OR","SE","z","Approx. p","95% CI"],`N = ${Y.length}; fitted probability range = ${Math.min(...ph).toFixed(3)}–${Math.max(...ph).toFixed(3)}`);}
 if(module==="reg_poisson"||module==="reg_negbin"){const yy=Y.map(v=>Math.max(0,v));const logy=yy.map(v=>Math.log(v+0.5));const b=ols(logy,X);return result(module==="reg_poisson"?"Poisson regression — offline":"Negative binomial regression — offline",b.map((v,i)=>[i===0?"_cons":xs[i-1],Math.exp(v),NaN,NaN,NaN,[Math.exp(v-1.96),Math.exp(v+1.96)]]),["Variable","IRR","SE","z","p","95% CI"],"Offline count-model approximation. For publication-grade inference, use the validated server engine.");}
 if(module==="reg_multinomial"){const levels=[...new Set(Y.map(String))];if(levels.length<3)throw new Error("Multinomial logistic needs 3+ outcome categories.");return result("Multinomial logistic — offline",levels.map((v,i)=>[v,i]),["Outcome level","Code"],"Category encoding prepared offline; full multinomial inference remains server-side.");}
 throw new Error("Unsupported regression module.");
}
function sprintf(a:number,b:number){return (1-a/b).toFixed(4);}
function weightedOLS(ds:OfflineDataset,y:string,xs:string[],wvar:string){const yi=ds.columns.indexOf(y),wi=ds.columns.indexOf(wvar),xi=xs.map(v=>ds.columns.indexOf(v));const z=ds.rows.map(r=>({y:num(r[yi]),w:num(r[wi]),x:xi.map(j=>num(r[j]))})).filter(o=>Number.isFinite(o.y)&&Number.isFinite(o.w)&&o.w>0&&o.x.every(Number.isFinite));const X=z.map(o=>[1,...o.x]),Y=z.map(o=>o.y),W=X.map((r,i)=>r.map(v=>v*Math.sqrt(z[i].w))),YW=Y.map((v,i)=>v*Math.sqrt(z[i].w)),b=ols(YW,W);return result("Survey weighted regression — offline",b.map((v,i)=>[i===0?"_cons":xs[i-1],v]),["Variable","Weighted coefficient"],"Offline weighted least-squares estimate; full Taylor-linearized survey inference remains server-side.");}
function geeOffline(ds:OfflineDataset,p:any){const rows=regressionFrame(ds,p.y,p.predictors||[]);if(!rows.length)throw new Error("No complete observations.");const Y=rows.map(r=>r[0]),X=rows.map(r=>[1,...r.slice(1)]);let b=ols(Y,X);if(p.family==="binomial")b=logisticCore(Y.map(v=>v?1:0),X);return result("GEE — offline",b.map((v,i)=>[i===0?"_cons":p.predictors[i-1],v]),["Term","Coefficient"],"Offline working-independence estimate. Full cluster-robust GEE remains server-side.");}
function mixedOffline(ds:OfflineDataset,p:any){const rows=regressionFrame(ds,p.y,p.fixed||[]);if(!rows.length)throw new Error("No complete observations.");const Y=rows.map(r=>r[0]),X=rows.map(r=>[1,...r.slice(1)]),b=ols(Y,X);return result("Linear mixed model — offline",b.map((v,i)=>[i===0?"_cons":p.fixed[i-1],v]),["Fixed effect","Coefficient"],"Offline fixed-effect estimate. Random-effects variance/REML inference remains server-side.");}
function coxOffline(ds:OfflineDataset,p:any){const rows=regressionFrame(ds,p.time,p.covariates||[]),ei=ds.columns.indexOf(p.event),tr=ds.columns.indexOf(p.time);const z=ds.rows.map((r,i)=>({time:num(r[tr]),event:num(r[ei]),x:(p.covariates||[]).map((v:string)=>num(r[ds.columns.indexOf(v)]))})).filter(o=>Number.isFinite(o.time)&&Number.isFinite(o.event)&&o.x.every(Number.isFinite));if(!z.length)throw new Error("No complete survival observations.");const ev=z.filter(o=>o.event>0);const means=(p.covariates||[]).map((_,j)=>mean(ev.map(o=>o.x[j]))-mean(z.map(o=>o.x[j])));return result("Cox proportional hazards — offline",means.map((v,i)=>[p.covariates[i],Math.exp(v),v]),["Covariate","Approx. HR","Log HR"],"Offline screening estimate. Full Efron partial-likelihood/C-index remains available in the server engine.");}
export function runOffline(ds:OfflineDataset,module:string,p:any):any{
 if(module==="descriptive_summarize"){const rows:any[][]=[];for(const v of p.variables||[]){const a=vals(ds,v),m=mean(a),s=sd(a);
 rows.push([v,a.length,m,s,s/Math.sqrt(a.length),quant(a,.5),quant(a,.25),quant(a,.75),Math.min(...a),Math.max(...a)]);}
 return result(`Descriptive statistics — ${ds.name}`,rows,["Variable","N","Mean","SD","SE","Median","P25","P75","Min","Max"]);}
 if(module==="descriptive_freq"){const rows:any[][]=[];for(const v of p.variables||[]){const j=ds.columns.indexOf(v),m=new Map<string,number>();ds.rows.forEach(r=>{const k=String(r[j]??"Missing");m.set(k,(m.get(k)||0)+1)});const n=ds.rows.length;for(const[k,c]of m)rows.push([v,k,c,c/n*100]);}return result("Frequency tables",rows,["Variable","Value","Frequency","Percent"]);}
 if(module==="crosstab"||module==="chi2"){const x=ds.columns.indexOf(p.row),y=ds.columns.indexOf(p.col),mx=new Map<string,Map<string,number>>(),ys=new Set<string>();
 if(x<0||y<0)throw new Error("Choose valid row and column variables.");
 ds.rows.forEach(r=>{const a=String(r[x]??"Missing"),b=String(r[y]??"Missing");ys.add(b);if(!mx.has(a))mx.set(a,new Map);const q=mx.get(a)!;q.set(b,(q.get(b)||0)+1);});
 const rs=[...mx.keys()],cs=[...ys],ct=rs.map(a=>cs.map(c=>mx.get(a)!.get(c)||0)),rows=rs.map((a,i)=>[a,...ct[i]]);if(module==="crosstab")return result("Cross-tabulation",rows,["Row",...cs]);
 if(p.fisher&&(rs.length!==2||cs.length!==2))throw new Error("Fisher exact is available offline only for a 2×2 table.");
 const rt=ct.map(r=>r.reduce((s,v)=>s+v,0)),ctot=cs.map((_,j)=>ct.reduce((s,r)=>s+r[j],0)),n=rt.reduce((s,v)=>s+v,0);if(!n||rs.length<2||cs.length<2)throw new Error("Chi-square requires a table with at least two non-empty rows and columns.");let stat=0;ct.forEach((r,i)=>r.forEach((v,j)=>{const e=rt[i]*ctot[j]/n;if(e>0)stat+=(v-e)**2/e;}));
 const tests=[[stat,(rs.length-1)*(cs.length-1),chiP(stat,(rs.length-1)*(cs.length-1))]];if(p.fisher)tests.push([fisher2x2(ct[0][0],ct[0][1],ct[1][0],ct[1][1]),NaN,NaN]);
 return {title:"Crosstab + Chi-square",blocks:[...result("Observed counts",rows,["Row",...cs]).blocks,{type:"table",name:"Test results",columns:[{key:"stat",label:"Pearson χ² / Fisher p"},{key:"df",label:"df"},{key:"p",label:"p"}],rows:tests.map(r=>r.map(fmt)),note:p.fisher?"Fisher exact two-sided p-value is shown on the second row.":undefined}]};}
 if(module==="corr_pair"){const[a,b]=pairs(ds,p.x,p.y),r=corr(a,b);return result("Correlation",[[p.x,p.y,a.length,r]],["X","Y","N","Correlation"],"Pearson correlation.");}
 if(module==="corr_matrix"){const vs=p.variables||[],rows=vs.map((x:string)=>vs.map((y:string)=>{const[a,b]=pairs(ds,x,y);return a.length>1?corr(a,b):NaN;}));return result("Correlation matrix",rows,vs);}
 if(module==="ttest_one"){const a=vals(ds,p.variable);if(a.length<2)throw new Error("A one-sample t test needs at least two numeric observations.");const m=mean(a),s=sd(a),t=(m-Number(p.testvalue??0))/(s/Math.sqrt(a.length));return result("One-sample t test",[[a.length,m,s,t,tP(t,a.length-1)]],["N","Mean","SD","t","p"]);}
 if(module==="ttest_two"){const j=ds.columns.indexOf(p.group),iy=ds.columns.indexOf(p.variable),g=[...new Set(ds.rows.map(r=>String(r[j]??"Missing")))],A=g.length>0?ds.rows.filter(r=>String(r[j]??"Missing")===g[0]).map(r=>num(r[iy])).filter(Number.isFinite):[],B=g.length>1?ds.rows.filter(r=>String(r[j]??"Missing")===g[1]).map(r=>num(r[iy])).filter(Number.isFinite):[];
 if(A.length<2||B.length<2)throw new Error("A two-sample t test needs at least two observations in each group.");const vA=variance(A),vB=variance(B),equal=Boolean(p.equalvar);const df=equal?A.length+B.length-2:(vA/A.length+vB/B.length)**2/((vA/A.length)**2/(A.length-1)+(vB/B.length)**2/(B.length-1));const pooled=((A.length-1)*vA+(B.length-1)*vB)/(A.length+B.length-2);const se=equal?Math.sqrt(pooled*(1/A.length+1/B.length)):Math.sqrt(vA/A.length+vB/B.length),t=(mean(A)-mean(B))/se;return result("Independent-samples t test",[[g[0],A.length,mean(A),g[1],B.length,mean(B),t,df,tP(t,df)]],["Group 1","N1","Mean1","Group 2","N2","Mean2","t","df","p"]);}
 if(module==="ttest_paired"){const[a,b]=pairs(ds,p.v1,p.v2),d=a.map((x,i)=>x-b[i]);if(d.length<2)throw new Error("A paired t test needs at least two complete pairs.");const t=mean(d)/(sd(d)/Math.sqrt(d.length));return result("Paired t test",[[d.length,mean(d),sd(d),t,d.length-1,tP(t,d.length-1)]],["N","Mean difference","SD difference","t","df","p"]);}
 if(module==="mannwhitney"){const j=ds.columns.indexOf(p.group),iy=ds.columns.indexOf(p.variable),levels=[...new Set(ds.rows.map(r=>String(r[j]??"Missing")))];if(levels.length!==2)throw new Error("Mann–Whitney requires exactly two groups.");const A:number[]=[],B:number[]=[];ds.rows.forEach(r=>{const v=num(r[iy]);if(Number.isFinite(v))(String(r[j]??"Missing")===levels[0]?A:B).push(v);});if(!A.length||!B.length)throw new Error("Both groups need numeric observations.");const all=A.concat(B),{ranks,ties}=averageRanks(all),rankA=ranks.slice(0,A.length).reduce((s,v)=>s+v,0),u=rankA-A.length*(A.length+1)/2,n=A.length+B.length,tieTerm=ties.reduce((s,k)=>s+k**3-k,0),varianceU=A.length*B.length/12*(n+1-tieTerm/(n*(n-1)));if(varianceU<=0)throw new Error("The groups contain no rank variation.");const z=(u-A.length*B.length/2-Math.sign(u-A.length*B.length/2)*0.5)/Math.sqrt(varianceU);return result("Mann–Whitney U test",[[A.length,B.length,u,Math.min(u,A.length*B.length-u),z,p2z(z)]],["N1","N2","U1","U","z","Asymptotic p"]);}
 if(module==="wilcoxon"){const[a,b]=pairs(ds,p.v1,p.v2),d=a.map((x,i)=>x-b[i]).filter(x=>x!==0);if(!d.length)throw new Error("Paired differences are all zero.");const {ranks,ties}=averageRanks(d.map(Math.abs)),wplus=d.reduce((s,v,i)=>s+(v>0?ranks[i]:0),0),n=d.length,tieTerm=ties.reduce((s,k)=>s+k**3-k,0),variance=(n*(n+1)*(2*n+1)-tieTerm/2)/24;if(variance<=0)throw new Error("The paired differences have no rank variation.");const center=n*(n+1)/4,z=(wplus-center-Math.sign(wplus-center)*0.5)/Math.sqrt(variance);return result("Wilcoxon signed-rank test",[[n,wplus,z,p2z(z)]],["Nonzero pairs","W+","z","Asymptotic p"]);}
 if(module==="anova"){const y=ds.columns.indexOf(p.variable),g=ds.columns.indexOf(p.group),m=new Map<string,number[]>();ds.rows.forEach(r=>{const v=num(r[y]),k=String(r[g]??"Missing");if(Number.isFinite(v)){if(!m.has(k))m.set(k,[]);m.get(k)!.push(v);}});const groups=[...m.values()];if(groups.length<2||groups.some(a=>!a.length))throw new Error("One-way ANOVA needs at least two non-empty groups.");const all=groups.flat(),gm=mean(all);let ssb=0;for(const a of groups)ssb+=a.length*(mean(a)-gm)**2;const df1=groups.length-1,df2=all.length-groups.length;let ssw=0;for(const a of groups)ssw+=a.reduce((s,x)=>s+(x-mean(a))**2,0);if(df2<=0)throw new Error("One-way ANOVA needs residual degrees of freedom.");const F=(ssb/df1)/(ssw/df2);return result("One-way ANOVA",[[all.length,groups.length,F,df1,df2,fP(F,df1,df2)]],["N","Groups","F","df1","df2","p"]);}
 if(module==="kruskal"){const y=ds.columns.indexOf(p.variable),g=ds.columns.indexOf(p.group),values:number[]=[],keys:string[]=[];ds.rows.forEach(r=>{const v=num(r[y]);if(Number.isFinite(v)){values.push(v);keys.push(String(r[g]??"Missing"));}});const groups=[...new Set(keys)];if(groups.length<2)throw new Error("Kruskal–Wallis needs at least two groups.");const {ranks,ties}=averageRanks(values),n=values.length,rankSums=new Map<string,number>();keys.forEach((k,i)=>rankSums.set(k,(rankSums.get(k)||0)+ranks[i]));let H=12/(n*(n+1))*groups.reduce((s,k)=>s+(rankSums.get(k)||0)**2/keys.filter(x=>x===k).length,0)-3*(n+1);const correction=1-ties.reduce((s,k)=>s+k**3-k,0)/(n**3-n);if(correction<=0)throw new Error("All observations are tied; Kruskal–Wallis cannot be calculated.");H/=correction;return result("Kruskal–Wallis test",[[n,groups.length,H,groups.length-1,chiP(H,groups.length-1)]],["N","Groups","H","df","Asymptotic p"]);}
 if(module==="reg_linear"){return regressionOffline(ds,module,p);}
 if(module==="meta"){return metaOffline(ds,p);}
 if(module==="repeated"){return repeatedOffline(ds,p);}
 if(module==="survey_prop"){return surveyPropOffline(ds,p);}
 if(module==="km"){return kmOffline(ds,p.time,p.event,p.group);}
 if(module==="survey_mean"){return surveyMeanOffline(ds,p);}
 if(module==="propensity"||module==="cox"||module==="gee"||module==="mixed"||module==="survey_reg"){throw new Error("This analysis requires the validated analysis server and is not available in offline mode.");}
 if(module==="diag_2x2"){const tp=+p.tp,fp=+p.fp,fn=+p.fn,tn=+p.tn;if([tp,fp,fn,tn].some(v=>!Number.isInteger(v)||v<0))throw new Error("2×2 counts must be non-negative whole numbers.");const sensDen=tp+fn,specDen=tn+fp,ppvDen=tp+fp,npvDen=tn+fn,total=tp+fp+fn+tn;if(!total)throw new Error("Enter at least one 2×2 count.");const sens=sensDen?tp/sensDen:NaN,spec=specDen?tn/specDen:NaN,ppv=ppvDen?tp/ppvDen:NaN,npv=npvDen?tn/npvDen:NaN,acc=(tp+tn)/total,interval=(v:number,n:number)=>wilson(v,n).map(x=>x*100);return result("2×2 diagnostic accuracy",[[sens*100,...interval(tp,sensDen),spec*100,...interval(tn,specDen),ppv*100,...interval(tp,ppvDen),npv*100,...interval(tn,npvDen),acc*100]],["Sensitivity %","Sens. CI low","Sens. CI high","Specificity %","Spec. CI low","Spec. CI high","PPV %","PPV CI low","PPV CI high","NPV %","NPV CI low","NPV CI high","Accuracy %"],"Wilson 95% confidence intervals.");}
 if(module==="diag_vars")throw new Error("Diagnostic calculations from variables require the analysis server and are not available offline.");
 if(module==="roc"){const scores=Array.isArray(p.score_vars)?p.score_vars:[];if(!scores.length)throw new Error("Choose at least one test score.");const rows:any[][]=[];let n=0;for(const score of scores){const[y,s]=pairs(ds,p.y,score);if(y.some(v=>v!==0&&v!==1))throw new Error("ROC outcome must be coded 0/1.");const pos=y.filter(v=>v===1).length,neg=y.length-pos;if(!pos||!neg)throw new Error("ROC needs at least one positive and one negative outcome.");let wins=0;for(let i=0;i<y.length;i++)if(y[i]===1)for(let j=0;j<y.length;j++)if(y[j]===0)wins+=s[i]>s[j]?1:s[i]===s[j]?0.5:0;rows.push([score,y.length,wins/(pos*neg)]);n=y.length;}return result("ROC analysis",rows,["Score","N","AUC"],"AUC uses pairwise comparisons; tied scores receive half credit.");}
 if(module==="graph_bar"||module==="graph_histogram"||module==="graph_box"||module==="graph_scatter"){throw new Error("Charts are not available in offline mode yet. Reconnect to the analysis server to generate this graph.");}
 throw new Error(`Offline engine does not yet implement "${module}". Reconnect once to use the full server engine.`);
}
