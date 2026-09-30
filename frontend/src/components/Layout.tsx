import React, { useState } from "react";
import { NavLink, useLocation, useNavigate } from "react-router-dom";
import { useApp } from "../state";
import { GROUPS, MODULES } from "../modules";

function NavItem({ to, icon, label, onClick }: { to: string; icon: string; label: string; onClick?: () => void }) {
  return (
    <NavLink
      to={to}
      onClick={onClick}
      className={({ isActive }) =>
        `flex items-center gap-2.5 rounded-lg px-3 py-[7px] text-[13px] font-medium transition ${
          isActive ? "bg-sky-600/90 text-white shadow" : "text-slate-300 hover:bg-white/5 hover:text-white"
        }`
      }
    >
      <span className="w-5 text-center text-[14px]">{icon}</span>
      <span className="truncate">{label}</span>
    </NavLink>
  );
}

export default function Layout({ children }: { children: React.ReactNode }) {
  const { user, logout, datasets, activeDataset, setActiveDataset, undo, redo, canUndo, canRedo } = useApp();
  const [openGroup, setOpenGroup] = useState<string | null>("03 · Descriptive");
  const [mobileOpen, setMobileOpen] = useState(false);
  const nav = useNavigate();
  const location = useLocation();

  return (
    <div className="flex h-screen w-full overflow-hidden bg-slate-100">
      {/* Sidebar */}
      <aside
        className={`fixed inset-y-0 left-0 z-40 flex w-60 shrink-0 flex-col bg-slate-900 transition-transform lg:static lg:translate-x-0 ${
          mobileOpen ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        <div className="flex items-center gap-2.5 px-4 py-4">
          <div className="grid h-9 w-9 place-items-center rounded-xl bg-gradient-to-br from-sky-400 to-sky-600 font-black text-white">
            S
          </div>
          <div>
            <div className="text-[15px] font-extrabold tracking-tight text-white">
              Stat<span className="text-sky-400">Med</span>X
            </div>
            <div className="text-[10px] font-medium uppercase tracking-widest text-slate-400">
              Medical statistics
            </div>
          </div>
        </div>

        {/* dataset picker */}
        <div className="mx-3 mb-3 rounded-xl bg-white/5 p-2.5">
          <div className="mb-1 text-[10px] font-bold uppercase tracking-wider text-slate-400">Dataset</div>
          <select
            className="w-full rounded-lg border border-white/10 bg-slate-800 px-2 py-1.5 text-[12.5px] text-slate-100 outline-none focus:border-sky-500"
            value={activeDataset?.id ?? ""}
            onChange={(e) => {
              const d = datasets.find((x) => x.id === Number(e.target.value));
              setActiveDataset(d || null);
            }}
          >
            {datasets.length === 0 && <option value="">— no datasets —</option>}
            {(Array.isArray(datasets) ? datasets : []).map((d) => (
              <option key={d.id} value={d.id}>
                {d.name} ({d.n_rows}×{d.n_cols})
              </option>
            ))}
          </select>
        </div>

        <nav className="flex-1 space-y-0.5 overflow-y-auto px-3 pb-4">
          <NavItem to="/" icon="⌂" label="Dashboard" onClick={() => setMobileOpen(false)} />
          <NavItem to="/data" icon="▦" label="Data editor" onClick={() => setMobileOpen(false)} />
          <NavItem to="/console" icon="›_" label="Command console" onClick={() => setMobileOpen(false)} />
          <NavItem to="/dofile" icon="⌨" label="Do-file editor" onClick={() => setMobileOpen(false)} />
          <NavItem to="/results" icon="🗂" label="Results window" onClick={() => setMobileOpen(false)} />
          <NavItem to="/projects" icon="▣" label="Analysis projects" onClick={() => setMobileOpen(false)} />
          <div className="pt-3" />
          {(Array.isArray(GROUPS) ? GROUPS : []).map((g) => (
            <div key={g}>
              <button
                className="flex w-full items-center justify-between rounded-lg px-3 py-1.5 text-[10.5px] font-bold uppercase tracking-wider text-slate-400 hover:text-slate-200"
                onClick={() => setOpenGroup(openGroup === g ? null : g)}
              >
                {g}
                <span className={`transition-transform ${openGroup === g ? "rotate-90" : ""}`}>›</span>
              </button>
              {openGroup === g && (
                <div className="space-y-0.5 pb-1">
                  {(Array.isArray(MODULES) ? MODULES : []).filter((m) => m.group === g).map((m) => (
                    <NavItem key={m.id} to={`/analysis/${m.id}`} icon={m.icon} label={m.title}
                             onClick={() => setMobileOpen(false)} />
                  ))}
                </div>
              )}
            </div>
          ))}
        </nav>

        <div className="border-t border-white/10 px-4 py-3">
          <div className="mb-3 border-b border-white/10 pb-3 text-[11px] text-slate-300">
            <div className="font-bold text-white">VELMURUGAN</div>
            <div>Statistician</div>
            <a className="mt-1 inline-block text-sky-300 hover:text-sky-200" href="mailto:velmurugan.stat@gmail.com">
              velmurugan.stat@gmail.com
            </a>
          </div>
          <div className="mb-1.5 truncate text-[12px] font-semibold text-slate-300">
            {user?.name || user?.email}
          </div>
          <button
            className="text-[12px] font-medium text-slate-400 hover:text-white"
            onClick={() => {
              logout();
              nav("/login");
            }}
          >
            Log out
          </button>
        </div>
      </aside>

      {mobileOpen && (
        <div className="fixed inset-0 z-30 bg-black/40 lg:hidden" onClick={() => setMobileOpen(false)} />
      )}

      {/* Main */}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center gap-3 border-b border-slate-200 bg-white px-4 py-2.5 lg:hidden">
          <button className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100" onClick={() => setMobileOpen(true)}>☰</button>
          <span className="font-extrabold text-slate-800">StatMedX</span>
        </header>
        <main className="min-h-0 flex-1 overflow-y-auto">
          <div className="mx-auto max-w-6xl px-4 py-5 lg:px-8 lg:py-7">
            <div className="mb-4">
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm font-medium text-slate-600 shadow-sm hover:bg-slate-50 hover:text-slate-900"
                  onClick={() => window.history.state?.idx > 0 ? nav(-1) : nav("/")}
                  aria-label="Go back to the previous page"
                >
                  ← Back{location.pathname === "/" ? " to app" : ""}
                </button>
                <button type="button" disabled={!canUndo} onClick={() => void undo().catch(e => window.alert(e.message))}
                  className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm font-medium text-slate-600 shadow-sm enabled:hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40" title="Undo the last data change">
                  ↶ Undo
                </button>
                <button type="button" disabled={!canRedo} onClick={() => void redo().catch(e => window.alert(e.message))}
                  className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm font-medium text-slate-600 shadow-sm enabled:hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40" title="Redo the last undone data change">
                  ↷ Redo
                </button>
              </div>
            </div>
            {children}
          </div>
        </main>
      </div>
    </div>
  );
}
