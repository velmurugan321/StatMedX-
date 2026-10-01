import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../api";
import { MODULES } from "../modules";
import { getOfflineDataset, offlineSchema } from "../offline";
import { useApp } from "../state";
import { Btn, ErrorNote, Spinner } from "../components/ui";

export default function GuidedAnalysis(){
 const {activeDataset,dataVersion}=useApp();const [schema,setSchema]=useState<any|null>(null);const [error,setError]=useState<string|null>(null);const [loading,setLoading]=useState(false);const nav=useNavigate();
 useEffect(()=>{
  let live=true;if(!activeDataset){setSchema(null);return;}
  setLoading(true);setError(null);
  const load=async()=>{
   try{if(activeDataset.id<0){const ds=await getOfflineDataset(activeDataset.id);if(live)setSchema(ds?offlineSchema(ds):null);}
    else{try{const value=await api(`/api/datasets/${activeDataset.id}/schema`);if(live)setSchema(value);}catch{const ds=await getOfflineDataset(activeDataset.id);if(live)setSchema(ds?offlineSchema(ds):null);}}
   }catch(e:any){if(live)setError(e.message||"Could not inspect this dataset.");}
   finally{if(live)setLoading(false);}
  };void load();return()=>{live=false;};
 },[activeDataset?.id,dataVersion]);

 const suggestions=useMemo(()=>{
  const cols=Array.isArray(schema?.columns)?schema.columns:[];
  const numeric=cols.filter((c:any)=>c.numeric);
  const groups=cols.filter((c:any)=>c.n_unique>=2&&c.n_unique<=15);
  const categorical=cols.filter((c:any)=>!c.numeric&&c.n_unique>=2&&c.n_unique<=15);
  const entries:{id:string;reason:string;params:Record<string,string|string[]>;caution?:string}[]=[];
  if(numeric.length)entries.push({id:"descriptive_summarize",reason:"Numeric variables are available for a quick overview of means, spread, and ranges.",params:{variables:numeric.slice(0,Math.min(4,numeric.length)).map((c:any)=>c.name)}});
  const frequencyVars=categorical.length?categorical:groups;
  if(frequencyVars.length)entries.push({id:"descriptive_freq",reason:"Frequency tables help inspect category counts and missing or unexpected levels.",params:{variables:frequencyVars.slice(0,3).map((c:any)=>c.name)}});
  const group2=groups.find((g:any)=>numeric.some((n:any)=>n.name!==g.name)&&g.n_unique===2);
  const outcome=numeric.find((n:any)=>n.name!==group2?.name);
  if(group2&&outcome)entries.push({id:"ttest_two",reason:`${group2.name} has two observed levels and ${outcome.name} is numeric, so a two-group comparison may fit your question.`,params:{variable:outcome.name,group:group2.name},caution:"Confirm that observations are independent and the outcome is suitable for comparing group means."});
  const group3=groups.find((g:any)=>g.n_unique>=3&&numeric.some((n:any)=>n.name!==g.name));
  if(group3){const y=numeric.find((n:any)=>n.name!==group3.name)!;entries.push({id:"anova",reason:`${group3.name} has ${group3.n_unique} observed levels and ${y.name} is numeric; compare group means.`,params:{variable:y.name,group:group3.name},caution:"Check independence and model assumptions; use the reported nonparametric cross-check when appropriate."});}
  if(categorical.length>=2)entries.push({id:"chi2",reason:"Two categorical variables are available for a contingency table and association test.",params:{row:categorical[0].name,col:categorical[1].name},caution:"An association does not establish causation; check expected cell counts."});
  if(numeric.length>=2)entries.push({id:"corr_pair",reason:"Two numeric variables are available to explore a linear or rank correlation.",params:{x:numeric[0].name,y:numeric[1].name},caution:"Correlation measures association, not causation."});
  if(numeric.length>=3)entries.push({id:"reg_linear",reason:"Several numeric variables are available for a basic linear model with one outcome and predictors.",params:{y:numeric[0].name,xs:numeric.slice(1,Math.min(4,numeric.length)).map((c:any)=>c.name)},caution:"Choose outcome and predictors based on your study design; this suggestion is not a causal model recommendation."});
  return entries;
 },[schema]);

 const open=(item:typeof suggestions[number])=>{const q=new URLSearchParams();for(const [key,value] of Object.entries(item.params))q.set(key,Array.isArray(value)?value.join("|"):value);nav(`/analysis/${item.id}?${q.toString()}`);};
 return <div className="space-y-5">
  <div><h1 className="text-xl font-extrabold tracking-tight text-slate-900">Guided analysis</h1><p className="text-[13px] text-slate-500">Suggestions use variable types and observed category counts to help you choose a starting point.</p></div>
  <ErrorNote msg={error}/>
  {!activeDataset?<div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-700">Select a dataset first.</div>:loading?<Spinner label="Reviewing dataset variables…"/>:<>
   <div className="rounded-xl border border-sky-200 bg-sky-50 p-4 text-sm text-sky-900"><b>{schema?.name||activeDataset.name}</b> · {Number(schema?.n_rows||0).toLocaleString()} rows · {schema?.n_cols||schema?.columns?.length||0} variables<p className="mt-1 text-xs text-sky-800">These are starting suggestions, not automatic test selection. Consider your study design, assumptions, and clinical/statistical plan.</p></div>
   {!suggestions.length?<div className="rounded-xl border border-slate-200 bg-white p-8 text-center text-sm text-slate-500">No recommendations yet. Import a dataset with columns and observations.</div>:<div className="grid gap-3 md:grid-cols-2">{suggestions.map((item,i)=>{const mod=MODULES.find(m=>m.id===item.id);if(!mod)return null;return <article key={`${item.id}-${i}`} className="flex flex-col rounded-xl border border-slate-200 bg-white p-4"><div className="flex items-start gap-3"><span className="text-2xl">{mod.icon}</span><div><h2 className="font-bold text-slate-800">{mod.title}</h2><p className="mt-1 text-sm text-slate-600">{item.reason}</p></div></div>{item.caution&&<p className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">Consider: {item.caution}</p>}<div className="mt-auto flex justify-end pt-4"><Btn variant="soft" onClick={()=>open(item)}>Configure this analysis →</Btn></div></article>;})}</div>}
  </>}
 </div>;
}
