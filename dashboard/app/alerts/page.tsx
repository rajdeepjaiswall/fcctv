"use client";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import Shell from "@/components/Shell";
import { api, timeIST, dateTimeIST } from "@/lib/client";
import { enablePush, pushEnabled, pushSupported } from "@/lib/push-client";

type Alert = {
  id: string; created_at: string; confidence: number; reason: string; seen: boolean; false_alarm: boolean; notified: boolean;
  session_id: string | null; rule_id: string; rule_name: string; alert_message: string | null; worker_id: string; worker_name: string; image: string | null;
};
type Count = { rule_name: string; worker_name: string; n: number };
const todayIST = () => new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });

export default function Alerts() {
  const [day, setDay] = useState(todayIST());
  const [data, setData] = useState<{ alerts: Alert[]; counts: Count[] } | null>(null);
  const [error, setError] = useState("");
  const [push, setPush] = useState<boolean | null>(null);
  const [pushMsg, setPushMsg] = useState("");
  const [open, setOpen] = useState<Alert | null>(null);
  const [focus, setFocus] = useState<string | null>(null);

  const load = useCallback(async () => {
    try { setData(await api(`/api/alerts?day=${day}`)); setError(""); } catch (e) { setError((e as Error).message); }
  }, [day]);

  useEffect(() => {
    setFocus(new URLSearchParams(window.location.search).get("focus"));
    pushEnabled().then(setPush);
    api("/api/alerts/seen", { method: "POST", body: "{}" }).catch(() => undefined);
  }, []);
  useEffect(() => { load(); const t = setInterval(load, 8000); return () => clearInterval(t); }, [load]);
  useEffect(() => { if (focus && data) { const a = data.alerts.find((x) => x.id === focus); if (a) setOpen(a); setFocus(null); } }, [focus, data]);

  const mark = async (a: Alert, falseAlarm: boolean) => {
    await api(`/api/alerts/${a.id}`, { method: "PATCH", body: JSON.stringify({ false_alarm: falseAlarm }) });
    load();
  };

  const total = data?.counts.reduce((n, c) => n + c.n, 0) ?? 0;
  return (
    <Shell>
      <div className="row spread"><h1>Alerts</h1>
        <input className="input" type="date" value={day} max={todayIST()} onChange={(e) => setDay(e.target.value)} />
      </div>

      <div className="card card-body" style={{ marginBottom: 14 }}>
        {push ? (
          <div className="row spread"><span>🔔 Phone notifications are <b>on</b> for this device.</span>
            <button className="btn ghost small" onClick={async () => { const r = await api<{ sent: number }>("/api/push/test", { method: "POST", body: "{}" }); setPushMsg(`Test sent to ${r.sent} device(s).`); }}>Send test</button>
          </div>
        ) : (
          <div className="row spread"><span>Get a notification on this phone for every alert.</span>
            <button className="btn" disabled={push === null || !pushSupported()} onClick={async () => {
              setPushMsg("");
              try { await enablePush(); setPush(true); setPushMsg("Done. You'll get alerts even when this page is closed."); }
              catch (e) { setPushMsg((e as Error).message); }
            }}>🔔 Turn on notifications</button>
          </div>
        )}
        {pushMsg && <p className="muted small" style={{ marginBottom: 0 }}>{pushMsg}</p>}
      </div>

      <div className="row" style={{ marginBottom: 6 }}>
        <div className="stat"><b>{total}</b>alerts {day === todayIST() ? "today" : `on ${day}`}</div>
        {data?.counts.map((c) => (
          <div key={c.rule_name + c.worker_name} className="stat"><b>{c.n}×</b>{c.rule_name}<br /><span className="muted small">{c.worker_name}</span></div>
        ))}
      </div>
      <p className="muted small">What to watch for is set in <Link href="/settings#alerts">Settings → Alert actions</Link>. Alerts are checked on photos during recording sessions.</p>
      {error && <div className="alert">{error}</div>}

      {data && data.alerts.length === 0 && <p className="muted">No alerts for this day.</p>}
      <ul className="list">
        {data?.alerts.map((a) => (
          <li key={a.id} className="row" style={{ alignItems: "flex-start", flexWrap: "nowrap", opacity: a.false_alarm ? 0.5 : 1 }}>
            <button className="thumb" style={{ width: 110, flex: "none" }} onClick={() => setOpen(a)}>
              {a.image ? <img src={a.image} alt="Alert photo" /> : <span>no photo</span>}
            </button>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div className="row spread">
                <b>{a.worker_name} {a.alert_message ?? a.rule_name}</b>
                <span className="muted small">{timeIST(a.created_at)}</span>
              </div>
              <div className="small" style={{ margin: "3px 0" }}>{a.reason}</div>
              <div className="row" style={{ gap: 6 }}>
                <span className="chip">{a.rule_name}</span>
                <span className="chip">{Math.round(a.confidence * 100)}% sure</span>
                {a.notified && <span className="chip">🔔 sent</span>}
                {a.false_alarm && <span className="chip">False alarm</span>}
              </div>
              <div className="row" style={{ gap: 6, marginTop: 6 }}>
                {a.false_alarm
                  ? <button className="btn ghost small" onClick={() => mark(a, false)}>Undo false alarm</button>
                  : <button className="btn ghost small" onClick={() => mark(a, true)}>Mark false alarm</button>}
                {a.session_id && <Link className="btn ghost small" href={`/session/${a.session_id}`}>Open session</Link>}
              </div>
            </div>
          </li>
        ))}
      </ul>

      {open && (
        <div className="lightbox" onClick={() => setOpen(null)} role="dialog">
          {open.image && <img src={open.image} alt="Alert photo" />}
          <p><b>{open.worker_name} {open.alert_message ?? open.rule_name}</b> · {dateTimeIST(open.created_at)}<br />{open.reason}</p>
        </div>
      )}
    </Shell>
  );
}
