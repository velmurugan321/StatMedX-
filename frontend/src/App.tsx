import { useEffect } from "react";
import { HashRouter, Navigate, Route, Routes, useLocation } from "react-router-dom";
import { useApp } from "./state";
import Layout from "./components/Layout";
import Login from "./pages/Login";
import Dashboard from "./pages/Dashboard";
import DataEditor from "./pages/DataEditor";
import Analysis from "./pages/Analysis";
import Console from "./pages/Console";
import DoFile from "./pages/DoFile";
import Results from "./pages/Results";
import Projects from "./pages/Projects";

function Shell() {
  const { user, loginDemo } = useApp();
  const location = useLocation();

  // auto-demo: if no session, silently start the demo workspace so the app is instantly usable
  useEffect(() => {
    if (!user) loginDemo().catch(() => {});
  }, [user, location.pathname]);

  if (location.pathname === "/login") return <Login />;

  if (!user) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-900 text-sm text-slate-400">
        <div className="flex items-center gap-2">
          <span className="h-4 w-4 animate-spin rounded-full border-2 border-sky-500 border-t-transparent" />
          Starting StatMedX demo workspace…
        </div>
      </div>
    );
  }

  return (
    <Layout>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/" element={<Dashboard />} />
        <Route path="/data" element={<DataEditor />} />
        <Route path="/analysis/:moduleId" element={<Analysis />} />
        <Route path="/console" element={<Console />} />
        <Route path="/dofile" element={<DoFile />} />
        <Route path="/results" element={<Results />} />
        <Route path="/projects" element={<Projects />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Layout>
  );
}

export default function App() {
  return (
    <HashRouter>
      <Shell />
    </HashRouter>
  );
}
