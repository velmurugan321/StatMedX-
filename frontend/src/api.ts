// Vite dev uses the local proxy. Production web/APK builds use the hosted API
// by default, while VITE_API_URL can still override it for other deployments.
const DEFAULT_API_URL = "https://statmedx-api.onrender.com";
const API_BASE = (
  import.meta.env.VITE_API_URL || (import.meta.env.PROD ? DEFAULT_API_URL : "")
).replace(/\/$/, "");
const TOKEN_KEY = "statmedx_token";
const USER_KEY = "statmedx_user";

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}
export function setAuth(token: string, user: any) {
  localStorage.setItem(TOKEN_KEY, token);
  localStorage.setItem(USER_KEY, JSON.stringify(user));
}
export function getUser(): any | null {
  try {
    return JSON.parse(localStorage.getItem(USER_KEY) || "null");
  } catch {
    return null;
  }
}
export function clearAuth() {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(USER_KEY);
}

export async function api<T = any>(path: string, opts: RequestInit = {}): Promise<T> {
  const headers: Record<string, string> = { ...(opts.headers as any) };
  if (!(opts.body instanceof FormData)) headers["Content-Type"] = "application/json";
  const token = getToken();
  if (token) headers["Authorization"] = `Bearer ${token}`;

  const url = `${API_BASE}${path}`;
  const res = await fetch(url, { ...opts, headers });

  if (res.status === 401) {
    clearAuth();
    window.location.hash = "#/login";
    throw new Error("Session expired — please log in again");
  }

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const detail = (data as any)?.detail;
    const msg =
      typeof detail === "string"
        ? detail
        : Array.isArray(detail)
        ? detail.map((d: any) => d.msg).join("; ")
        : `Request failed (${res.status})`;
    throw new Error(msg);
  }
  return data as T;
}

export function downloadUrl(path: string): string {
  const token = getToken() || "";
  return `${API_BASE}${path}${path.includes("?") ? "&" : "?"}token=${encodeURIComponent(token)}`;
}

export async function downloadFile(path: string, filename: string): Promise<void> {
  const headers: Record<string, string> = {};
  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  const response = await fetch(`${API_BASE}${path}`, { headers });
  if (response.status === 401) {
    clearAuth();
    window.location.hash = "#/login";
    throw new Error("Session expired — please log in again");
  }
  if (!response.ok) throw new Error(`Download failed (${response.status})`);
  const url = URL.createObjectURL(await response.blob());
  const link = document.createElement("a");
  link.href = url; link.download = filename; link.style.display = "none";
  document.body.appendChild(link); link.click(); link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

