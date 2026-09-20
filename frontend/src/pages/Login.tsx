import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { api, setAuth } from "../api";
import { useApp } from "../state";
import { Btn, ErrorNote, inputCls } from "../components/ui";

export default function Login() {
  const [mode, setMode] = useState<"login" | "register">("login");
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const { setUser, refreshDatasets, loginDemo } = useApp();
  const nav = useNavigate();

  const afterAuth = async (u: any) => {
    setAuth(u.token, u);
    setUser(u);
    await refreshDatasets();
    nav("/");
  };

  const submit = async () => {
    setErr(null);
    setBusy(true);
    try {
      const path = mode === "login" ? "/api/auth/login" : "/api/auth/register";
      const body = mode === "login" ? { email, password } : { email, password, name };
      const u = await api<any>(path, { method: "POST", body: JSON.stringify(body) });
      await afterAuth(u);
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  };

  const demo = async () => {
    setErr(null);
    setBusy(true);
    try {
      await loginDemo();
      nav("/");
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-slate-900 via-slate-800 to-sky-950 p-6">
      <div className="w-full max-w-sm">
        <div className="mb-6 text-center">
          <div className="mx-auto mb-3 grid h-14 w-14 place-items-center rounded-2xl bg-gradient-to-br from-sky-400 to-sky-600 text-2xl font-black text-white shadow-lg">
            S
          </div>
          <h1 className="text-2xl font-extrabold tracking-tight text-white">
            Stat<span className="text-sky-400">Med</span>X
          </h1>
          <p className="mt-1 text-[13px] text-slate-400">
            Statistical analysis platform for medical research
          </p>
        </div>

        <div className="rounded-2xl bg-white p-6 shadow-2xl">
          <div className="mb-4 flex rounded-lg bg-slate-100 p-1 text-[13px] font-semibold">
            {(["login", "register"] as const).map((m) => (
              <button
                key={m}
                className={`flex-1 rounded-md py-1.5 capitalize transition ${
                  mode === m ? "bg-white text-slate-800 shadow" : "text-slate-500"
                }`}
                onClick={() => setMode(m)}
              >
                {m}
              </button>
            ))}
          </div>

          <div className="space-y-3">
            {mode === "register" && (
              <input className={inputCls} placeholder="Your name" value={name} onChange={(e) => setName(e.target.value)} />
            )}
            <input className={inputCls} placeholder="Email" type="email" value={email}
                   onChange={(e) => setEmail(e.target.value)} />
            <input className={inputCls} placeholder="Password (min 6 chars)" type="password" value={password}
                   onChange={(e) => setPassword(e.target.value)}
                   onKeyDown={(e) => e.key === "Enter" && submit()} />
            <ErrorNote msg={err} />
            <Btn className="w-full py-2" onClick={submit} disabled={busy}>
              {busy ? "Please wait…" : mode === "login" ? "Log in" : "Create account"}
            </Btn>
            <div className="flex items-center gap-3 text-[11px] text-slate-400">
              <div className="h-px flex-1 bg-slate-200" /> or <div className="h-px flex-1 bg-slate-200" />
            </div>
            <Btn variant="soft" className="w-full py-2" onClick={demo} disabled={busy}>
              🚀 Try the demo workspace (no signup)
            </Btn>
            <p className="text-center text-[11px] text-slate-400">
              Demo includes 2 sample datasets & all modules
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
