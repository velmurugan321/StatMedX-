import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../api";
import { useApp } from "../state";
import { Btn, ErrorNote, Spinner } from "../components/ui";
import { cloneOfflineDataset, deleteAnalysisProject, listAnalysisProjects, listOfflineResults, saveAnalysisProject, saveOfflineDataset, saveOfflineResult, type SavedProject } from "../offline";

export default function Projects(){
 const {activeDataset,captureDataset,refreshDatasets,setActiveDataset}=useApp();
 const [projects,setProjects]=useState<SavedProject[]>([]);const [name,setName]=useState("");const [busy,setBusy]=useState(false);const [error,setError]=useState<string|null>(null);const nav=useNavigate();
 const importRef=useRef<HTMLInputElement>(null);
 const load=async()=>setProjects(await listAnalysisProjects());
 useEffect(()=>{load().catch(e=>setError(e.message));},[]);

 const saveProject=async()=>{
  if(!activeDataset)return;setBusy(true);setError(null);
  try{
   const snapshot=await captureDataset(activeDataset);
   let results:any[]=[];
   if(activeDataset.id<0)results=await listOfflineResults(activeDataset.id);
   else{
    try{const summaries=await api<any[]>(`/api/results?dataset_id=${activeDataset.id}&limit=200`);results=await Promise.all((Array.isArray(summaries)?summaries:[]).map((r:any)=>api(`/api/results/${r.id}`)));}
    catch{results=await listOfflineResults(activeDataset.id);}
   }
   let commands:string[]=[];
   if(activeDataset.id>0){try{commands=await api<string[]>(`/api/commands/history?dataset_id=${activeDataset.id}&limit=100`);}catch{}}
   if(!commands.length){try{const saved=JSON.parse(localStorage.getItem(`statmedx_command_history_${activeDataset.id}`)||"[]");if(Array.isArray(saved))commands=saved;}catch{}}
   await saveAnalysisProject({name:name.trim()||`${snapshot.name} analysis`,dataset:snapshot,commands,results});
   setName("");await load();
  }catch(e:any){setError(e.message||"Could not save the analysis project.");}
  finally{setBusy(false);}
 };

 const openProject=async(project:SavedProject)=>{
  setBusy(true);setError(null);
  try{
   const dataset=cloneOfflineDataset(project.dataset,project.dataset.name);
   await saveOfflineDataset(dataset);
   for(const result of project.results||[])await saveOfflineResult({dataset_id:dataset.id,module:result.module||result.request?.module||"analysis",title:result.title||"Saved result",result:result.result||result});
   try{localStorage.setItem(`statmedx_command_history_${dataset.id}`,JSON.stringify(project.commands||[]));}catch{}
   await refreshDatasets();setActiveDataset(dataset);nav("/results");
  }catch(e:any){setError(e.message||"Could not open the saved project.");}
  finally{setBusy(false);}
 };

 const removeProject=async(id:number)=>{if(!confirm("Delete this saved project? Its dataset and results in the app will not be deleted."))return;await deleteAnalysisProject(id);await load();};
 const exportProject=(project:SavedProject)=>{
  const payload={format:"statmedx-analysis-project",version:1,project:{name:project.name,dataset:project.dataset,commands:project.commands||[],results:project.results||[]}};
  const blob=new Blob([JSON.stringify(payload,null,2)],{type:"application/json"});const url=URL.createObjectURL(blob);const a=document.createElement("a");
  a.href=url;a.download=`${project.name.replace(/[^a-z0-9_-]+/gi,"_")||"statmedx-project"}.statmedx.json`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
 };
 const importProject=async(file:File)=>{
  setBusy(true);setError(null);
  try{
   const payload=JSON.parse(await file.text());const p=payload?.project;const ds=p?.dataset;
   if(payload?.format!=="statmedx-analysis-project"||payload?.version!==1||typeof p?.name!=="string"||!Array.isArray(ds?.columns)||!Array.isArray(ds?.rows)||!ds.columns.length||ds.rows.some((r:any)=>!Array.isArray(r)||r.length!==ds.columns.length))throw new Error("This is not a valid StatMedX project backup.");
   await saveAnalysisProject({name:p.name,dataset:{...ds,remote_dataset_id:undefined},commands:Array.isArray(p.commands)?p.commands.filter((c:any)=>typeof c==="string"):[],results:Array.isArray(p.results)?p.results:[]});
   await load();
  }catch(e:any){setError(e instanceof SyntaxError?"The backup file is damaged or not valid JSON.":e.message||"Could not import the project backup.");}
  finally{setBusy(false);if(importRef.current)importRef.current.value="";}
 };
 return <div className="space-y-4">
  <div className="flex flex-wrap items-end justify-between gap-3"><div><h1 className="text-xl font-extrabold tracking-tight text-slate-900">Analysis projects</h1><p className="text-[13px] text-slate-500">Save a dataset snapshot with results and commands; export a backup to move it to another device.</p></div><div><input ref={importRef} type="file" accept=".json,.statmedx.json,application/json" className="hidden" onChange={e=>{const file=e.currentTarget.files?.[0];if(file)void importProject(file);}}/><Btn variant="soft" disabled={busy} onClick={()=>importRef.current?.click()}>Import project backup</Btn></div></div>
  <ErrorNote msg={error}/>
  <section className="flex flex-col gap-3 rounded-xl border border-slate-200 bg-white p-4 sm:flex-row sm:items-end">
   <label className="flex-1 text-xs font-semibold text-slate-600">Project name<input className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-sky-500" value={name} onChange={e=>setName(e.target.value)} placeholder={activeDataset?`${activeDataset.name} analysis`:"Name this project"}/></label>
   <Btn onClick={()=>void saveProject()} disabled={!activeDataset||busy}>{busy?"Saving…":"Save current analysis"}</Btn>
  </section>
  <div className="space-y-2">
   {busy&&!projects.length&&<Spinner label="Loading projects…"/>}
   {!projects.length&&!busy&&<div className="rounded-xl border border-dashed border-slate-300 bg-white p-8 text-center text-sm text-slate-500">No saved projects yet. Choose a dataset and save your first analysis project.</div>}
   {projects.map(project=><article key={project.id} className="flex flex-col gap-3 rounded-xl border border-slate-200 bg-white p-4 sm:flex-row sm:items-center sm:justify-between">
    <div><h2 className="font-bold text-slate-800">{project.name}</h2><p className="text-xs text-slate-500">{project.dataset.name} · {project.dataset.n_rows.toLocaleString()} rows × {project.dataset.n_cols} variables · {(project.results||[]).length} results · {(project.commands||[]).length} commands</p><p className="mt-1 text-[11px] text-slate-400">Saved {new Date(project.created_at).toLocaleString()}</p></div>
    <div className="flex flex-wrap gap-2"><Btn variant="ghost" disabled={busy} onClick={()=>exportProject(project)}>Export backup</Btn><Btn variant="soft" disabled={busy} onClick={()=>void openProject(project)}>Open project</Btn><Btn variant="ghost" disabled={busy} onClick={()=>void removeProject(project.id)}>Delete</Btn></div>
   </article>)}
  </div>
 </div>;
}
