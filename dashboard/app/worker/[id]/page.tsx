"use client";
import { use, useCallback, useEffect, useState } from "react";
import Shell from "@/components/Shell";
import { api, ago, liveStatus, stableUrl, timeIST, dateTimeIST } from "@/lib/client";

type Device = {
  id: string; mode: string; live_requested: boolean; battery: number | null; charging: boolean | null; phone_battery: number | null;
  status_detail: string | null; last_seen: string | null; last_frame_at: string | null; frame_url: string | null;
  paired_at: string | null; pair_code: string | null; pair_expires_at: string | null; consent_at: string | null; consent_name: string | null;
  glasses_name: string | null; app_version: string | null;
};
type Snapshot = { id: string; url: string; source: string; battery: number | null; taken_at: string };
type Session = { id: string; started_at: string; ended_at: string | null; snapshots: number };
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
      const r = await api<Detail>(`/api/workers/${id}?day=${day}`);
      if (r.device) r.device.frame_url = stableUrl(`w-${id}`, r.device.last_frame_at, r.device.frame_url);
      r.snapshots = r.snapshots.map((s) => ({ ...s, url: stableUrl(`s-${s.id}`, s.id, s.url) ?? s.url }));
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
  const st = liveStatus({ mode: dev?.mode ?? null, last_seen: dev?.last_seen ?? null, paired_at: dev?.paired_at ?? null }, now);

  return (
    <Shell>
      <div className="row spread">
        <h1>{d.worker.name}</h1>
        <span className={`badge ${st.cls}`}><span className="dot" />{st.label}</span>
      </div>
      {error && <div className="alert">{error}</div>}

      <div className="card">
        <div className="frame" style={{ aspectRatio: "4 / 3", maxHeight: "75vh" }}>
          {dev?.frame_url ? <img src={dev.frame_url} alt={`Live view from ${d.worker.name}`} /> : <span>No picture yet</span>}
          {dev?.last_frame_at && <span className="age">{timeIST(dev.last_frame_at)} · {ago(dev.last_frame_at, now)}</span>}
        </div>
        <div className="card-body">
          <div className="row">
            {dev?.paired_at && (
              <button className={`btn ${dev.live_requested ? "brown" : ""}`} onClick={() => patch({ live: !dev.live_requested })}>
                {dev.live_requested ? "Stop live video" : "Watch live video"}
              </button>
            )}
            <span className="muted small">
              {dev?.live_requested && dev.mode !== "live" ? "Waiting for the phone to switch to live… " : ""}
              Live video drains the glasses battery fast; snapshots are much lighter.
            </span>
          </div>
          <p className="muted small" style={{ marginTop: 10 }}>
            Glasses battery: <b>{dev?.battery != null ? `${dev.battery}%${dev.charging ? " ⚡ charging" : ""}` : "—"}</b> ·
            Phone battery: <b>{dev?.phone_battery != null ? `${dev.phone_battery}%` : "—"}</b> ·
            Last seen: <b>{ago(dev?.last_seen, now)}</b>
            {dev?.status_detail ? <> · {dev.status_detail}</> : null}
          </p>
        </div>
      </div>

      <h2>Snapshot timeline</h2>
      <div className="row" style={{ marginBottom: 10 }}>
        <input className="input" type="date" value={day} max={todayIST()} onChange={(e) => setDay(e.target.value)} />
        <span className="muted small">{d.snapshots.length} photos (newest first)</span>
      </div>
      {d.snapshots.length === 0 ? <p className="muted">No photos for this day.</p> : (
        <div className="thumbs">
          {d.snapshots.map((s) => (
            <button key={s.id} className="thumb" onClick={() => setOpen(s)}>
              <img src={s.url} alt={`Photo at ${timeIST(s.taken_at)}`} loading="lazy" />
              <span>{timeIST(s.taken_at)}</span>
            </button>
          ))}
        </div>
      )}

      <h2>Duty sessions</h2>
      {d.sessions.length === 0 ? <p className="muted">No sessions yet.</p> : (
        <ul className="list">
          {d.sessions.map((s) => (
            <li key={s.id}>
              <b>{dateTimeIST(s.started_at)}</b> → {s.ended_at ? dateTimeIST(s.ended_at) : <span className="badge snap">on duty</span>}
              <span className="muted small"> · {s.snapshots} photos</span>
            </li>
          ))}
        </ul>
      )}

      <h2>Activity</h2>
      <ul className="list">
        {d.events.map((e) => (<li key={e.id}><span className="muted small">{dateTimeIST(e.created_at)}</span> — {e.message ?? e.type}</li>))}
      </ul>

      <h2>Phone & consent</h2>
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

      {open && (
        <div className="lightbox" onClick={() => setOpen(null)} role="dialog">
          <img src={open.url} alt="Snapshot" />
          <p>{dateTimeIST(open.taken_at)} {open.battery != null ? `· glasses ${open.battery}%` : ""} — tap to close</p>
        </div>
      )}
    </Shell>
  );
}
