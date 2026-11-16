export const API_BASE = import.meta.env.VITE_API_BASE ?? "";

export const classNames = (...items: Array<string | false | null | undefined>) =>
  items.filter(Boolean).join(" ");

export const loadToken = () => localStorage.getItem("dashboard_token") ?? "";
export const saveToken = (token: string) => localStorage.setItem("dashboard_token", token);
export const clearToken = () => localStorage.removeItem("dashboard_token");

export async function apiFetch<T>(path: string, token: string, options: RequestInit = {}): Promise<T> {
  const headers = new Headers(options.headers);
  if (options.body != null && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");
  if (token && !headers.has("Authorization")) headers.set("Authorization", `Bearer ${token}`);
  const response = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers,
  });
  if (!response.ok) {
    const body = await response.text();
    let detail = response.headers.get("content-type")?.includes("text/html") ? "" : body;
    try {
      const parsed = JSON.parse(body);
      if (typeof parsed?.detail === "string") detail = parsed.detail;
      else if (Array.isArray(parsed?.detail)) detail = parsed.detail.map((item: { loc?: unknown[]; msg?: unknown }) => {
        const field = Array.isArray(item?.loc) ? item.loc.filter((part) => part !== "body").join(".") : "";
        return [field, typeof item?.msg === "string" ? item.msg : "参数无效"].filter(Boolean).join("：");
      }).join("；");
      else if (typeof parsed?.message === "string") detail = parsed.message;
      else detail = "";
    } catch { /* Non-JSON error responses may contain a useful plain message. */ }
    throw new Error(detail || `请求失败（${response.status}）`);
  }
  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

export function wsUrl(path: string, token: string) {
  const base = API_BASE || window.location.origin;
  const url = new URL(path, base);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  url.searchParams.set("token", token);
  return url.toString();
}

export function formatNumber(value?: number | null, suffix = "%") {
  if (value === undefined || value === null || Number.isNaN(value)) return "--";
  return `${value.toFixed(1)}${suffix}`;
}
