"use client";
import { useEffect, useState } from "react";
import { api } from "@/lib/client";

type Rule = {
  id: string; text: string; name: string | null; look_for: string | null; alert_message: string | null; ai_note: string | null;
  understood: boolean; alert_enabled: boolean; min_duration_sec: number; min_confidence: number; cooldown_sec: number;
  worker_ids: string[] | null; today: number;
};
type Worker = { id: string; name: string };

/** Settings → Alert actions: type what to watch for, the AI confirms (✓), then "Alert me" turns alerts on. */
export default function AlertActions() {
  const [rules, setRules] = useState<Rule[]>([]);
  const [workers, setWorkers] = useState<Worker[]>([]);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<Record<string, string>>({});
  const [openId, setOpenId] = useState<string | null>(null);
  const [error, setError] = useState("");

  const load = () => api<{ rules: Rule[]; workers: Worker[] }>("/api/rules").then((r) => { setRules(r.rules); setWorkers(r.workers); }).catch((e) => setError(e.message));
  useEffect(() => { load(); }, []);

  const send = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!text.trim()) return;
    setSending(true); setError("");
    try { await api("/api/rules", { method: "POST", body: JSON.stringify({ text }) }); setText(""); await load(); }
    catch (err) { setError((err as Error).message); }
    setSending(false);
  };
  const patch = async (r: Rule, body: object) => {
    setBusyId(r.id);
    try { await api(`/api/rules/${r.id}`, { method: "PATCH", body: JSON.stringify(body) }); await load(); }
    catch (err) { setError((err as Error).message); }
    setBusyId(null);
  };
  const examples = ["Using a mobile phone", "Sitting idle for more than 5 minutes", "Smoking a cigarette", "Counting money", "Eating at the counter", "फ़ोन पर बात करना"];

  return (
    <div className="card card-body" id="alerts" style={{ maxWidth: 560, marginTop: 16 }}>
      <h2 style={{ marginTop: 0 }}>Alert actions</h2>
      <p className="muted small">Type what you want to know about, in English or Hindi, and tap Send. The AI confirms it understood (✓). Then tap <b>Alert me</b> to get notified every time it happens.</p>
      <form onSubmit={send} className="row" style={{ flexWrap: "nowrap" }}>
        <input className="input" style={{ flex: 1 }} placeholder="e.g. sitting idle for more than 5 minutes" value={text} onChange={(e) => setText(e.target.value)} />
        <button className="btn" disabled={sending || !text.trim()}>{sending ? "Understanding…" : "Send"}</button>
      </form>
      <div className="row" style={{ gap: 6, margin: "8px 0 14px" }}>
        {examples.map((x) => <button key={x} type="button" className="btn ghost small" onClick={() => setText(x)}>{x}</button>)}
      </div>
      {error && <div className="alert">{error}</div>}

      <ul className="list">
        {rules.map((r) => (
          <li key={r.id}>
            <div className="row spread" style={{ flexWrap: "nowrap" }}>
              <div className="row" style={{ flexWrap: "nowrap", minWidth: 0 }}>
                {r.understood ? <span className="tick" title="Understood">✓</span> : <span className="tick" style={{ background: "var(--muddy-brown)", color: "var(--white)" }}>?</span>}
                <div style={{ minWidth: 0 }}>
                  <b>{r.name ?? r.text}</b>
                  <div className="muted small">“{r.text}”{r.today ? ` · ${r.today}× today` : ""}</div>
                </div>
              </div>
              {r.understood ? (
                <button className={`btn small ${r.alert_enabled ? "" : "ghost"}`} disabled={busyId === r.id}
                  onClick={() => patch(r, { alert_enabled: !r.alert_enabled })}>
                  {r.alert_enabled ? "🔔 Alerting" : "Alert me"}
                </button>
              ) : (
                <button className="btn ghost small" disabled={busyId === r.id} onClick={() => patch(r, { retry: true })}>{busyId === r.id ? "…" : "Retry"}</button>
              )}
            </div>
            {r.ai_note && <p className="small" style={{ margin: "6px 0 0 32px" }}>{r.ai_note}</p>}
            <div style={{ margin: "6px 0 0 32px" }}>
              <button type="button" className="btn ghost small" onClick={() => setOpenId(openId === r.id ? null : r.id)}>{openId === r.id ? "Hide options" : "Options"}</button>
            </div>
            {openId === r.id && (
              <div style={{ margin: "10px 0 0 32px" }}>
                {r.look_for && <p className="muted small"><b>AI checks for:</b> {r.look_for}</p>}
                <div className="field"><label>Alert only if it continues for</label>
                  <select className="input" value={r.min_duration_sec} onChange={(e) => patch(r, { min_duration_sec: Number(e.target.value) })}>
                    {[0, 30, 60, 120, 300, 600, 900, 1800].map((n) => <option key={n} value={n}>{n === 0 ? "Immediately" : n < 60 ? `${n} seconds` : `${n / 60} minutes`}</option>)}
                    {![0, 30, 60, 120, 300, 600, 900, 1800].includes(r.min_duration_sec) && <option value={r.min_duration_sec}>{r.min_duration_sec} seconds</option>}
                  </select></div>
                <div className="field"><label>Don&apos;t repeat the same alert for</label>
                  <select className="input" value={r.cooldown_sec} onChange={(e) => patch(r, { cooldown_sec: Number(e.target.value) })}>
                    {[60, 180, 300, 600, 1800, 3600].map((n) => <option key={n} value={n}>{n / 60} minute{n > 60 ? "s" : ""}</option>)}
                  </select></div>
                <div className="field"><label>How sure the AI must be</label>
                  <select className="input" value={Math.round(r.min_confidence * 100)} onChange={(e) => patch(r, { min_confidence: Number(e.target.value) / 100 })}>
                    {[50, 60, 65, 70, 80, 90].map((n) => <option key={n} value={n}>{n}%{n === 65 ? " (recommended)" : ""}</option>)}
                  </select></div>
                <div className="field"><label>Workers</label>
                  <div className="row" style={{ gap: 6 }}>
                    <button type="button" className={`btn small ${!r.worker_ids?.length ? "" : "ghost"}`} onClick={() => patch(r, { worker_ids: [] })}>All</button>
                    {workers.map((w) => {
                      const on = !!r.worker_ids?.includes(w.id);
                      const next = on ? (r.worker_ids ?? []).filter((x) => x !== w.id) : [...(r.worker_ids ?? []), w.id];
                      return <button key={w.id} type="button" className={`btn small ${on ? "" : "ghost"}`} onClick={() => patch(r, { worker_ids: next })}>{w.name}</button>;
                    })}
                  </div></div>
                <div className="row" style={{ gap: 6 }}>
                  <button type="button" className="btn ghost small" disabled={busyId === r.id || !r.understood} onClick={async () => {
                    setBusyId(r.id); setTestResult((t) => ({ ...t, [r.id]: "Testing on the latest session…" }));
                    try {
                      const t = await api<{ checked: number; matched: number; examples: string[]; note: string }>(`/api/rules/${r.id}/test`, { method: "POST", body: "{}" });
                      setTestResult((x) => ({ ...x, [r.id]: `${t.note} Found in ${t.matched} of ${t.checked} moments.${t.examples.length ? " e.g. " + t.examples.join(" / ") : ""}` }));
                    } catch (e) { setTestResult((x) => ({ ...x, [r.id]: (e as Error).message })); }
                    setBusyId(null);
                  }}>Test on latest session</button>
                  <button type="button" className="btn ghost small" onClick={() => { if (confirm(`Delete “${r.name ?? r.text}” and its alerts?`)) api(`/api/rules/${r.id}`, { method: "DELETE" }).then(load); }}>Delete</button>
                </div>
                {testResult[r.id] && <p className="small">{testResult[r.id]}</p>}
              </div>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
