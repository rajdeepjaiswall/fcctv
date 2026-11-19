"use client";
import { use, useCallback, useEffect, useState } from "react";
import Link from "next/link";
import Shell from "@/components/Shell";
import SessionControls from "@/components/SessionControls";
import SessionCard, { type SessionRow } from "@/components/SessionCard";
import { api, ago, liveStatus, stableUrl, timeIST, dateTimeIST, batteryText } from "@/lib/client";

type Device = {
  id: string; mode: string; live_requested: boolean; battery: number | null; charging: boolean | null; phone_battery: number | null;
  status_detail: string | null; last_seen: string | null; last_frame_at: string | null; frame_url: string | null;
  paired_at: string | null; pair_code: string | null; pair_expires_at: string | null; consent_at: string | null; consent_name: string | null;
  glasses_name: string | null; app_version: string | null;
  duty_requested: boolean; capture_mode: string; active_session_id: string | null;
  battery_at: string | null; phone_battery_at: string | null; glasses_connected: boolean | null;
};
type Snapshot = { id: string; url: string; source: string; battery: number | null; taken_at: string };
type Session = SessionRow;
type Event = { id: string; type: string; message: string | null; created_at: string };
type Detail = { worker: { id: string; name: string; active: boolean }; device: Device | null; sessions: Session[]; snapshots: Snapshot[]; events: Event[] };

const todayIST = () => new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });

export default function WorkerPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [d, setD] = useState<Detail | null>(null);
  const [day, setDay] = useState(todayIST());
  const [error, setError] = useState("");
  const [open, setOpen] = useState<Snapshot | null>(null);
  const [now, setNow] = useState(Date.now());
  const [code, setCode] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const r = await api<Detail>(`/api/workers/${id}`);
      if (r.device) r.device.frame_url = stableUrl(`w-${id}`, r.device.last_frame_at, r.device.frame_url);
      r.snapshots = r.snapshots.map((s) => ({ ...s, url: stableUrl(`s-${s.id}`, s.id, s.url) ?? s.url }));
      r.sessions = r.sessions.map((x) => ({ ...x, cover: stableUrl(`c-${x.id}`, `${x.id}-${x.snapshots}`, x.cover) }));
      setD(r); setError(""); setNow(Date.now());
    } catch (e) { setError((e as Error).message); }
  }, [id, day]);

  const live = d?.device?.mode === "live";
  useEffect(() => {
    load();
    const t = setInterval(load, live ? 1000 : 3000);
    return () => clearInterval(t);
  }, [load, live]);

  const patch = async (body: object) => {
    const r = await api<{ pair_code?: string }>(`/api/workers/${id}`, { method: "PATCH", body: JSON.stringify(body) });
    if (r.pair_code) setCode(r.pair_code);
    load();
  };

  if (!d) return <Shell>{error ? <div className="alert">{error}</div> : <p className="muted">Loading…</p>}</Shell>;
  const dev = d.device;
  const st = liveStatus({ mode: dev?.mode ?? null, last_seen: dev?.last_seen ?? null, paired_at: dev?.paired_at ?? null, live_requested: dev?.live_requested ?? null }, now);
  const g = batteryText(dev?.battery ?? null, dev?.battery_at ?? null, dev?.charging, now);
  const p = batteryText(dev?.phone_battery ?? null, dev?.phone_battery_at ?? null, false, now);
  const showFrame = !!dev && (dev.mode === "live" || dev.mode === "snapshot" || !!dev.active_session_id || dev.live_requested);

  return (
    <Shell>
      <p className="small"><Link href="/">← All staff</Link></p>
      <div className="row spread">
        <h1 style={{ margin: 0 }}>{d.worker.name}</h1>
        <span className={`badge ${st.cls}`}><span className="dot" />{st.label}</span>
      </div>
      <div className="row" style={{ gap: 8, margin: "10px 0 14px" }}>
        <div className={`batt ${g.fresh ? (dev?.battery != null && dev.battery <= 20 ? "low" : "ok") : "stale"}`}><span className="batt-label">Glasses</span><b>{g.text}</b></div>
        <div className={`batt ${p.fresh ? "ok" : "stale"}`}><span className="batt-label">Phone</span><b>{p.text}</b></div>
        {dev?.glasses_connected === false && <span className="chip">Glasses not connected</span>}
      </div>
      {error && <div className="alert">{error}</div>}

      <div className="card">
        {showFrame && (
          <div className="frame" style={{ maxHeight: "60vh" }}>
            {dev?.frame_url ? <img src={dev.frame_url} alt={`Live view from ${d.worker.name}`} /> : <span>Waiting for the first picture…</span>}
            {dev?.last_frame_at && <span className="age">{timeIST(dev.last_frame_at)} · {ago(dev.last_frame_at, now)}</span>}
          </div>
        )}
        <div className="card-body">
          <SessionControls workerId={id} paired={!!dev?.paired_at} online={!!dev?.last_seen && now - new Date(dev.last_seen).getTime() < 60_000}
            sessionId={dev?.active_session_id ?? null} mode={dev?.capture_mode ?? null} liveRequested={!!dev?.live_requested} onChange={load} />
          {dev?.status_detail && <p className="muted small" style={{ margin: "8px 0 0" }}>Phone: {dev.status_detail}</p>}
        </div>
      </div>

      <h2>Sessions</h2>
      {d.sessions.length === 0 ? <p className="muted">No sessions yet. Tap “Start photos” or “Start video” above.</p> : (
        <div className="grid">
          {d.sessions.map((s) => <SessionCard key={s.id} s={s} now={now} onDone={load} />)}
        </div>
      )}

      <h2>Activity</h2>
      <ul className="list">
        {d.events.slice(0, 20).map((e) => (<li key={e.id}><span className="muted small">{dateTimeIST(e.created_at)}</span> — {e.message ?? e.type}</li>))}
      </ul>

      <h2>Phone &amp; consent</h2>
      <div className="card card-body">
        {dev?.paired_at ? (
          <p className="small">
            Paired {dateTimeIST(dev.paired_at)} · Glasses {dev.glasses_name ?? "—"} · App {dev.app_version ?? "—"}<br />
            Consent accepted by <b>{dev.consent_name ?? "—"}</b> on {dev.consent_at ? dateTimeIST(dev.consent_at) : "—"}
          </p>
        ) : <p className="small">Not paired yet{dev?.pair_code ? <> — pairing code <b>{dev.pair_code}</b></> : null}.</p>}
        {code && <p>New pairing code: <span className="code">{code}</span><br /><span className="muted small">Valid 24 hours. The old phone is unpaired.</span></p>}
        <div className="row">
          <button className="btn ghost" onClick={() => { if (confirm("Make a new pairing code? The current phone will be disconnected.")) patch({ newPairCode: true }); }}>New pairing code</button>
          <button className="btn ghost" onClick={() => patch({ active: !d.worker.active })}>{d.worker.active ? "Deactivate worker" : "Reactivate worker"}</button>
          <button className="btn brown" onClick={async () => {
            if (!confirm(`Delete ${d.worker.name} and all their photos? This can't be undone.`)) return;
            await api(`/api/workers/${id}`, { method: "DELETE" }); window.location.href = "/workers";
          }}>Delete worker</button>
        </div>
      </div>
    </Shell>
  );
}
