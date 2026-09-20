import React, { createContext, useContext, useEffect, useState } from "react";
import { api, clearAuth, getUser, setAuth } from "./api";

interface Ctx {
  user: any | null;
  setUser: (u: any | null) => void;
  datasets: any[];
  activeDataset: any | null;
  setActiveDataset: (d: any | null) => void;
  refreshDatasets: () => Promise<void>;
  loginDemo: () => Promise<void>;
  logout: () => void;
  dataVersion: number;
  bumpData: () => void;
}

const AppCtx = createContext<Ctx>(null as any);
export const useApp = () => useContext(AppCtx);

export function AppProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<any | null>(getUser());
  const [datasets, setDatasets] = useState<any[]>([]);
  const [activeDataset, setActiveDataset] = useState<any | null>(null);
  const [dataVersion, setDataVersion] = useState(0);

  const refreshDatasets = async () => {
    try {
      const list = await api<any[]>("/api/datasets");
      setDatasets(list);
      setActiveDataset((cur) => {
        if (cur && list.some((d) => d.id === cur.id)) {
          const upd = list.find((d) => d.id === cur.id)!;
          return upd;
        }
        return cur ?? list[0] ?? null;
      });
    } catch {
      /* not logged in */
    }
  };

  const loginDemo = async () => {
    const u = await api<any>("/api/auth/demo", { method: "POST" });
    setAuth(u.token, u);
    setUser(u);
    await refreshDatasets();
  };

  const logout = () => {
    clearAuth();
    setUser(null);
    setDatasets([]);
    setActiveDataset(null);
  };

  const bumpData = () => setDataVersion((v) => v + 1);

  useEffect(() => {
    if (user) refreshDatasets();
  }, [user]);

  return (
    <AppCtx.Provider
      value={{
        user,
        setUser,
        datasets,
        activeDataset,
        setActiveDataset,
        refreshDatasets,
        loginDemo,
        logout,
        dataVersion,
        bumpData,
      }}
    >
      {children}
    </AppCtx.Provider>
  );
}
