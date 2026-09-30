import React, { createContext, useContext, useEffect, useRef, useState } from "react";
import { api, clearAuth, getUser, setAuth } from "./api";
import { getOfflineDataset, listOfflineDatasets, saveOfflineDataset } from "./offline";

export type DatasetSnapshot = { id:number; name:string; description?:string; source_format:string; columns:string[]; rows:any[][]; n_rows:number; n_cols:number; remote_dataset_id?:number };

interface Ctx {
  user: any | null; setUser: (u:any|null)=>void;
  datasets: any[]; activeDataset:any|null; setActiveDataset:(d:any|null)=>void;
  refreshDatasets:()=>Promise<void>; loginDemo:()=>Promise<void>; logout:()=>void;
  dataVersion:number; bumpData:()=>void;
  captureDataset:(dataset:any)=>Promise<DatasetSnapshot>; recordUndo:(snapshot:DatasetSnapshot)=>void;
  undo:()=>Promise<void>; redo:()=>Promise<void>; canUndo:boolean; canRedo:boolean;
}
const AppCtx=createContext<Ctx>(null as any);
export const useApp=()=>useContext(AppCtx);

export function AppProvider({children}:{children:React.ReactNode}){
 const [user,setUser]=useState<any|null>(getUser());
 const [datasets,setDatasets]=useState<any[]>([]);
 const [activeDataset,setActiveDataset]=useState<any|null>(null);
 const [dataVersion,setDataVersion]=useState(0);
 const history=useRef(new Map<number,{undo:DatasetSnapshot[];redo:DatasetSnapshot[]}>());
 const [,setHistoryVersion]=useState(0);
 const recordUndo=(snapshot:DatasetSnapshot)=>{const h=history.current.get(snapshot.id)||{undo:[],redo:[]};h.undo.push(snapshot);if(h.undo.length>30)h.undo.shift();h.redo=[];history.current.set(snapshot.id,h);setHistoryVersion(v=>v+1);};
 const captureDataset=async(dataset:any):Promise<DatasetSnapshot>=>{
  if(dataset.id<0){const ds=await getOfflineDataset(dataset.id);if(!ds)throw new Error("Dataset not found.");return JSON.parse(JSON.stringify(ds));}
  const first=await api<any>(`/api/datasets/${dataset.id}/data?page=1&size=500`);
  const columns=(first.columns||[]).map((c:any)=>c.name),rows:any[][]=(first.rows||[]).map((r:any)=>columns.map((c:string)=>r[c]));let page=2;
  while(rows.length<Number(first.total||0)){const next=await api<any>(`/api/datasets/${dataset.id}/data?page=${page++}&size=500`);rows.push(...(next.rows||[]).map((r:any)=>columns.map((c:string)=>r[c])));if(!(next.rows||[]).length)break;}
  return {id:dataset.id,name:dataset.name||"Dataset",description:dataset.description,source_format:dataset.source_format||"data",columns,rows,n_rows:rows.length,n_cols:columns.length};
 };
 const restoreSnapshot=async(snapshot:DatasetSnapshot)=>{if(snapshot.id<0){await saveOfflineDataset(snapshot);setActiveDataset(snapshot);}else{await api(`/api/datasets/${snapshot.id}/data`,{method:"PUT",body:JSON.stringify({columns:snapshot.columns,rows:snapshot.rows})});setActiveDataset({...snapshot});}setDatasets(cur=>cur.map(d=>d.id===snapshot.id?{...d,n_rows:snapshot.n_rows,n_cols:snapshot.n_cols}:d));setDataVersion(v=>v+1);};
 const undo=async()=>{const id=activeDataset?.id;if(id==null)return;const h=history.current.get(id);if(!h?.undo.length)return;const current=await captureDataset(activeDataset);const target=h.undo.pop()!;h.redo.push(current);await restoreSnapshot(target);setHistoryVersion(v=>v+1);};
 const redo=async()=>{const id=activeDataset?.id;if(id==null)return;const h=history.current.get(id);if(!h?.redo.length)return;const current=await captureDataset(activeDataset);const target=h.redo.pop()!;h.undo.push(current);await restoreSnapshot(target);setHistoryVersion(v=>v+1);};
 const canUndo=!!activeDataset&&!!history.current.get(activeDataset.id)?.undo.length;const canRedo=!!activeDataset&&!!history.current.get(activeDataset.id)?.redo.length;

 const refreshDatasets=async()=>{
  try{
   const list=await api<any[]>("/api/datasets");
   if (!Array.isArray(list)) throw new Error("Invalid datasets response");
   const local=await listOfflineDatasets();
   const combined=[...local,...list];
   setDatasets(combined);
   setActiveDataset(cur=>combined.find(d=>d.id===cur?.id)??combined[0]??null);
  }catch{
   const local=await listOfflineDatasets();
   setDatasets(local);
   setActiveDataset(cur=>local.find(d=>d.id===cur?.id)??local[0]??null);
  }
 };
 const loginDemo=async()=>{
  try {
   const u=await api<any>("/api/auth/demo",{method:"POST"});
   setAuth(u.token,u);setUser(u);await refreshDatasets();
  } catch {
   setUser({id:0,name:"Offline User",offline:true});
   await refreshDatasets();
  }
 };
 const logout=()=>{clearAuth();setUser(null);setDatasets([]);setActiveDataset(null);};
 const bumpData=()=>setDataVersion(v=>v+1);
 useEffect(()=>{refreshDatasets();},[user]);
 return <AppCtx.Provider value={{user,setUser,datasets,activeDataset,setActiveDataset,refreshDatasets,loginDemo,logout,dataVersion,bumpData,captureDataset,recordUndo,undo,redo,canUndo,canRedo}}>{children}</AppCtx.Provider>;
}
