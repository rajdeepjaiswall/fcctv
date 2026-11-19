"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import Shell from "@/components/Shell";
import SessionControls from "@/components/SessionControls";
import { api, ago, liveStatus, stableUrl, type WorkerRow } from "@/lib/client";

/** Live grid: every worker's latest frame, refreshed every 2 s. */
export default function LiveGrid() {
  const [rows, setRows] = useState<WorkerRow[] | null>(null);
  const [error, setError] = useState("");
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    let stop = false;
    const load = async () => {
      try { const r = await api<{ workers: WorkerRow[] }>("/api/overview"); if (!stop) { setRows(r.workers.map((w) => ({ ...w, frame_url: stableUrl(w.id, w.last_frame_at, w.frame_url) }))); setError(""); setNow(Date.now()); } }
      catch (e) { if (!stop) setError((e as Error).message); }
    };
    load();
    const t = setInterval(load, 2000);
    return () => { stop = true; clearInterval(t); };
  }, []);


  const active = rows?.filter((w) => w.active) ?? [];
  return (
    <Shell>
      <div className="row spread"><h1>Live view</h1><span className="muted small">Updates every 2 seconds</span></div>
      {error && <div className="alert">{error}</div>}
      {rows && active.length === 0 && (
        <div className="card card-body">No workers yet. <Link href="/workers">Add a worker</Link> and pair their phone.</div>
      )}
      <div className="grid">
        {active.map((w) => {
          const st = liveStatus(w, now);
          return (
            <div className="card" key={w.id}>
              <Link href={`/worker/${w.id}`} className="frame" aria-label={`Open ${w.name}`}>
                {w.frame_url ? <img src={w.frame_url} alt={`Latest view from ${w.name}`} /> : <span className="muted">No picture yet</span>}
                <span className={`badge ${st.cls}`}><span className="dot" />{st.label}</span>
                {w.last_frame_at && <span className="age">{ago(w.last_frame_at, now)}</span>}
              </Link>
              <div className="card-body">
                <div className="row spread">
                  <b>{w.name}</b>
                  <span className="muted small">
                    {w.battery != null ? `Glasses ${w.battery}%${w.charging ? " ⚡" : ""}` : ""}
                    {w.phone_battery != null ? ` · Phone ${w.phone_battery}%` : ""}
                  </span>
                </div>
                {w.status_detail && <div className="muted small" style={{ marginTop: 4 }}>{w.status_detail}</div>}
                <div style={{ marginTop: 10 }}>
                  <SessionControls workerId={w.id} paired={!!w.paired_at} online={!!w.last_seen && now - new Date(w.last_seen).getTime() < 60_000}
                    sessionId={w.active_session_id} mode={w.capture_mode} liveRequested={!!w.live_requested} />
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </Shell>
  );
}
