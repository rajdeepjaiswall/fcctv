"use client";

/** fetch() helper for the owner's browser; bounces to /login when the session is gone. */
export async function api<T = unknown>(path: string, init?: RequestInit & { body?: BodyInit | null }): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
    cache: "no-store",
  });
  if (res.status === 401 && typeof window !== "undefined" && !path.startsWith("/api/auth")) {
    window.location.href = "/login";
    throw new Error("Please log in.");
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data as { error?: string }).error ?? `Error ${res.status}`);
  return data as T;
}

export function ago(iso?: string | null, now = Date.now()): string {
  if (!iso) return "never";
  const s = Math.max(0, Math.round((now - new Date(iso).getTime()) / 1000));
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

export const timeIST = (iso: string) =>
  new Date(iso).toLocaleTimeString("en-IN", { timeZone: "Asia/Kolkata", hour: "2-digit", minute: "2-digit", second: "2-digit" });

export const dateTimeIST = (iso: string) =>
  new Date(iso).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

export type WorkerRow = {
  id: string; name: string; active: boolean; device_id: string | null; mode: string | null; live_requested: boolean | null;
  battery: number | null; charging: boolean | null; phone_battery: number | null; status_detail: string | null;
  last_seen: string | null; last_frame_at: string | null; frame_url: string | null; paired_at: string | null;
  pair_code: string | null; glasses_name: string | null;
  duty_requested: boolean | null; capture_mode: string | null; active_session_id: string | null;
  battery_at: string | null; phone_battery_at: string | null; glasses_connected: boolean | null;
  session_count: number; alerts_today: number;
};

/** Battery text that never pretends: fresh (<3 min) shows the number; older shows "last X% · 2h ago". */
export function batteryText(pct: number | null, at: string | null, charging?: boolean | null, now = Date.now()) {
  if (pct == null) return { text: "—", fresh: false };
  const fresh = !!at && now - new Date(at).getTime() < 180_000;
  return { text: fresh ? `${pct}%${charging ? " ⚡" : ""}` : `last ${pct}% · ${ago(at, now)}`, fresh };
}

/** What to show on a worker's badge. */
export function liveStatus(w: { mode: string | null; last_seen: string | null; paired_at: string | null }, now = Date.now()) {
  if (!w.paired_at) return { cls: "warn", label: "Not paired" };
  const fresh = w.last_seen && now - new Date(w.last_seen).getTime() < 60_000;
  if (!fresh) return { cls: "off", label: "Offline" };
  if (w.mode === "live") return { cls: "live", label: "LIVE" };
  if (w.mode === "snapshot") return { cls: "live", label: "Recording photos" };
  if (w.mode === "paused") return { cls: "warn", label: "Outside hours" };
  if (w.mode === "standby") return { cls: "snap", label: "Ready" };
  return { cls: "off", label: "Off duty" };
}

/**
 * Signed photo links change on every poll even when the photo hasn't. Keep the old link (so the
 * browser doesn't re-download) while the frame time is unchanged and the link is under 4 minutes old.
 */
const linkCache = new Map<string, { at: string | null; url: string; t: number }>();
export function stableUrl(id: string, frameAt: string | null, url: string | null): string | null {
  if (!url) return null;
  const prev = linkCache.get(id);
  if (prev && prev.at === frameAt && Date.now() - prev.t < 240_000) return prev.url;
  linkCache.set(id, { at: frameAt, url, t: Date.now() });
  return url;
}
