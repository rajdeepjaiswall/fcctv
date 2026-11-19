"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import Shell from "@/components/Shell";
import { api, liveStatus, batteryText, type WorkerRow } from "@/lib/client";

/** Staff list: name, status and real battery. Tap a name for their session cards. */
export default function Staff() {
  const [rows, setRows] = useState<WorkerRow[] | null>(null);
  const [error, setError] = useState("");
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    let stop = false;
    const load = async () => {
      try { const r = await api<{ workers: WorkerRow[] }>("/api/overview"); if (!stop) { setRows(r.workers); setError(""); setNow(Date.now()); } }
      catch (e) { if (!stop) setError((e as Error).message); }
    };
    load();
    const t = setInterval(load, 5000);
    return () => { stop = true; clearInterval(t); };
  }, []);

  const active = rows?.filter((w) => w.active) ?? [];
  return (
    <Shell>
      <h1>Staff</h1>
      {error && <div className="alert">{error}</div>}
      {rows && active.length === 0 && <div className="card card-body">No staff yet. <Link href="/workers">Add a worker</Link> and pair their phone.</div>}
      <div className="staff">
        {active.map((w) => {
          const st = liveStatus(w, now);
          const g = batteryText(w.battery, w.battery_at, w.charging, now);
          const p = batteryText(w.phone_battery, w.phone_battery_at, false, now);
          const low = g.fresh && w.battery != null && w.battery <= 20;
          return (
            <Link key={w.id} href={`/worker/${w.id}`} className="staff-row">
              <div style={{ minWidth: 0 }}>
                <div className="staff-name">{w.name}</div>
                <span className={`badge ${st.cls}`}><span className="dot" />{st.label}</span>
                {w.alerts_today > 0 && <span className="chip" style={{ marginLeft: 6 }}>⚠ {w.alerts_today} today</span>}
              </div>
              <div className="staff-batt">
                <div className={`batt ${g.fresh ? (low ? "low" : "ok") : "stale"}`}>
                  <span className="batt-label">Glasses</span><b>{g.text}</b>
                </div>
                <div className={`batt ${p.fresh ? "ok" : "stale"}`}>
                  <span className="batt-label">Phone</span><b>{p.text}</b>
                </div>
              </div>
            </Link>
          );
        })}
      </div>
    </Shell>
  );
}
