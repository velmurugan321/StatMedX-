import React, { createContext, useContext, useEffect, useState } from "react";
import { api, clearAuth, getUser, setAuth } from "./api";
import { listOfflineDatasets } from "./offline";

interface Ctx {
  user: any | null; setUser: (u:any|null)=>void;
  datasets: any[]; activeDataset:any|null; setActiveDataset:(d:any|null)=>void;
  refreshDatasets:()=>Promise<void>; loginDemo:()=>Promise<void>; logout:()=>void;
  dataVersion:number; bumpData:()=>void;
}
const AppCtx=createContext<Ctx>(null as any);
export const useApp=()=>useContext(AppCtx);

export function AppProvider({children}:{children:React.ReactNode}){
 const [user,setUser]=useState<any|null>(getUser());
 const [datasets,setDatasets]=useState<any[]>([]);
 const [activeDataset,setActiveDataset]=useState<any|null>(null);
 const [dataVersion,setDataVersion]=useState(0);

 const refreshDatasets=async()=>{
  try{
   const list=await api<any[]>("/api/datasets");
   setDatasets(list);
   setActiveDataset(cur=>cur&&list.some(d=>d.id===cur.id)?list.find(d=>d.id===cur.id)!:cur??list[0]??null);
  }catch{
   const local=await listOfflineDatasets();
   setDatasets(local);
   setActiveDataset(cur=>cur&&local.some(d=>d.id===cur.id)?local.find(d=>d.id===cur.id)!:cur??local[0]??null);
  }
 };
 const loginDemo=async()=>{
  const u=await api<any>("/api/auth/demo",{method:"POST"});
  setAuth(u.token,u);setUser(u);await refreshDatasets();
 };
 const logout=()=>{clearAuth();setUser(null);setDatasets([]);setActiveDataset(null);};
 const bumpData=()=>setDataVersion(v=>v+1);
 useEffect(()=>{refreshDatasets();},[user]);
 return <AppCtx.Provider value={{user,setUser,datasets,activeDataset,setActiveDataset,refreshDatasets,loginDemo,logout,dataVersion,bumpData}}>{children}</AppCtx.Provider>;
}
