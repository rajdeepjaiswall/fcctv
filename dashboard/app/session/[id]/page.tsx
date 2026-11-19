"use client";
import Link from "next/link";
import { use, useCallback, useEffect, useRef, useState } from "react";
import Shell from "@/components/Shell";
import { api, stableUrl, timeIST, dateTimeIST } from "@/lib/client";

type Session = {
  id: string; worker_id: string; worker_name: string; mode: string; status: string; started_at: string; ended_at: string | null;
  snapshots: number; summary: string | null; ai_error: string | null; analysed_count: number;
};
type Note = { id: string; idx: number; from_at: string; to_at: string; text: string; thumbs: string[] };
type Msg = { id: string; role: "user" | "assistant"; content: string; created_at: string; pending?: boolean };
type SAlert = { id: string; created_at: string; reason: string; false_alarm: boolean; rule_name: string; image: string | null };
type Snap = { id: string; taken_at: string; url: string | null };
type Data = { session: Session; notes: Note[]; messages: Msg[]; snapshots: Snap[]; alerts: SAlert[] };

export default function SessionPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [d, setD] = useState<Data | null>(null);
  const [error, setError] = useState("");
  const [q, setQ] = useState("");
  const [asking, setAsking] = useState(false);
  const [pending, setPending] = useState<string | null>(null);
  const [open, setOpen] = useState<Snap | null>(null);
  const [showPhotos, setShowPhotos] = useState(false);
  const stepping = useRef(false);
  const bottom = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    try {
      const r = await api<Data>(`/api/sessions/${id}`);
      r.snapshots = r.snapshots.map((s) => ({ ...s, url: stableUrl(`s-${s.id}`, s.id, s.url) }));
      setD(r); setError("");
    } catch (e) { setError((e as Error).message); }
  }, [id]);

  // Poll; while analysing, also drive the analysis forward one step at a time.
  useEffect(() => {
    load();
    const t = setInterval(async () => {
      await load();
    }, 4000);
    return () => clearInterval(t);
  }, [load]);

  const status = d?.session.status;
  const waiting = !!d?.messages.some((m) => m.pending);
  useEffect(() => {
    if (status !== "analysing" && status !== "recording" && !waiting) return;
    let stop = false;
    const tick = async () => {
      if (stepping.current || stop) return;
      stepping.current = true;
      try { await api(`/api/sessions/${id}/analyse`, { method: "POST", body: "{}" }); } catch { /* shown via ai_error */ }
      stepping.current = false;
    };
    tick();
    const t = setInterval(tick, status === "analysing" || waiting ? 4000 : 20000);
    return () => { stop = true; clearInterval(t); };
  }, [id, status, waiting]);

  useEffect(() => { bottom.current?.scrollIntoView({ behavior: "smooth" }); }, [d?.messages.length, pending]);

  const ask = async (e: React.FormEvent) => {
    e.preventDefault();
    const question = q.trim();
    if (!question) return;
    setAsking(true); setPending(question); setQ(""); setError("");
    try { await api(`/api/sessions/${id}/chat`, { method: "POST", body: JSON.stringify({ question }) }); await load(); }
    catch (err) { setError((err as Error).message); setQ(question); }
    finally { setAsking(false); setPending(null); }
  };

  if (!d) return <Shell>{error ? <div className="alert">{error}</div> : <p className="muted">Loading…</p>}</Shell>;
  const s = d.session;
  const st = s.status === "recording" ? ["live", "Recording"] : s.status === "analysing" ? ["warn", "Analysing…"] : s.status === "done" ? ["snap", "Summary ready"] : ["off", s.status];
  const suggestions = ["Did they use their phone?", "When were they idle?", "How many customers did they serve?", "Was cash handled?"];

  return (
    <Shell>
      <p className="small"><Link href={`/worker/${s.worker_id}`}>← {s.worker_name}</Link></p>
      <div className="row spread">
        <h1>{s.mode === "video" ? "Video" : "Photo"} session · {dateTimeIST(s.started_at)}</h1>
        <span className={`badge ${st[0]}`}><span className="dot" />{st[1]}</span>
      </div>
      <p className="muted small">
        {timeIST(s.started_at)} → {s.ended_at ? timeIST(s.ended_at) : "now"} · {d.snapshots.length} frames · {d.notes.length} timeline notes
      </p>
      {s.ai_error && <div className="alert">AI: {s.ai_error} {s.ai_error.includes("key") && <Link href="/settings">Open Settings</Link>}</div>}
      {s.status === "analysing" && (
        <div className="ok">Analysing what happened… {d.notes.length} notes written. Keep this page open to finish faster.</div>
      )}

      <h2>Timeline</h2>
      {d.notes.length === 0 ? <p className="muted">{s.status === "recording" ? "Notes appear here every few photos while recording." : "No notes yet."}</p> : (
        <ul className="list">
          {d.notes.map((n) => (
            <li key={n.id}>
              <div className="muted small"><b>{timeIST(n.from_at)} – {timeIST(n.to_at)}</b></div>
              <div style={{ margin: "4px 0 6px" }}>{n.text}</div>
              <div className="row" style={{ gap: 4, flexWrap: "nowrap", overflowX: "auto" }}>
                {n.thumbs.map((u, i) => <img key={i} src={u} alt="" style={{ height: 44, borderRadius: 6 }} loading="lazy" />)}
              </div>
            </li>
          ))}
        </ul>
      )}

      {d.alerts.length > 0 && (
        <>
          <h2>Alerts in this session ({d.alerts.filter((a) => !a.false_alarm).length})</h2>
          <ul className="list">
            {d.alerts.map((a) => (
              <li key={a.id} className="row" style={{ flexWrap: "nowrap", opacity: a.false_alarm ? 0.5 : 1 }}>
                {a.image && <img src={a.image} alt="" style={{ width: 72, borderRadius: 8 }} />}
                <span><b>{timeIST(a.created_at)} · {a.rule_name}</b>{a.false_alarm ? " (false alarm)" : ""}<br /><span className="small">{a.reason}</span></span>
              </li>
            ))}
          </ul>
        </>
      )}

      <h2>Chat about this session</h2>
      <div className="card card-body">
        {d.messages.length === 0 && !pending && (
          <p className="muted small">{s.status === "recording" ? "Stop the session to get the summary. You can already ask questions about what's been captured." : "The summary will appear here as the first message."}</p>
        )}
        {d.messages.map((m) => (
          <div key={m.id}>
            <Bubble role={m.role} text={m.content} at={m.created_at} />
            {m.pending && <Bubble role="assistant" text="AI is busy right now — your question is queued and will be answered here in a moment." />}
          </div>
        ))}
        {pending && <><Bubble role="user" text={pending} /><Bubble role="assistant" text="Looking at the photos…" /></>}
        <div ref={bottom} />
        <div className="row" style={{ margin: "10px 0" }}>
          {suggestions.map((t) => <button key={t} type="button" className="btn ghost small" onClick={() => setQ(t)}>{t}</button>)}
        </div>
        <form onSubmit={ask} className="row" style={{ flexWrap: "nowrap" }}>
          <input className="input" style={{ flex: 1 }} placeholder="Ask anything about this session (English or Hindi)…" value={q} onChange={(e) => setQ(e.target.value)} />
          <button className="btn" disabled={asking || !q.trim()}>{asking ? "…" : "Ask"}</button>
        </form>
        {error && <div className="alert" style={{ marginTop: 10 }}>{error}</div>}
      </div>

      <h2>All frames</h2>
      {!showPhotos ? <button className="btn ghost" onClick={() => setShowPhotos(true)}>Show {d.snapshots.length} frames</button> : (
        <div className="thumbs">
          {d.snapshots.map((p) => (
            <button key={p.id} className="thumb" onClick={() => setOpen(p)}>
              {p.url && <img src={p.url} alt={`Frame at ${timeIST(p.taken_at)}`} loading="lazy" />}
              <span>{timeIST(p.taken_at)}</span>
            </button>
          ))}
        </div>
      )}

      <div className="row" style={{ marginTop: 24 }}>
        {s.ended_at && <button className="btn ghost" onClick={async () => { await api(`/api/sessions/${id}/analyse`, { method: "POST", body: JSON.stringify({ restart: true }) }); load(); }}>Re-analyse session</button>}
        {s.ended_at && <button className="btn brown" onClick={async () => {
          if (!confirm("Delete this session and all its frames?")) return;
          await api(`/api/sessions/${id}`, { method: "DELETE" }); window.location.href = `/worker/${s.worker_id}`;
        }}>Delete session</button>}
      </div>

      {open?.url && (
        <div className="lightbox" onClick={() => setOpen(null)} role="dialog">
          <img src={open.url} alt="Frame" /><p>{dateTimeIST(open.taken_at)} — tap to close</p>
        </div>
      )}
    </Shell>
  );
}

function Bubble({ role, text, at }: { role: "user" | "assistant"; text: string; at?: string }) {
  const me = role === "user";
  return (
    <div style={{ display: "flex", justifyContent: me ? "flex-end" : "flex-start", margin: "8px 0" }}>
      <div style={{
        maxWidth: "88%", whiteSpace: "pre-wrap", padding: "10px 12px", borderRadius: 14,
        background: me ? "var(--leafy-green)" : "var(--bg)", color: me ? "var(--black)" : "var(--fg)",
        border: me ? "none" : "1px solid var(--line)",
      }}>
        {!me && <div className="small" style={{ fontWeight: 700, color: "var(--muddy-brown)", marginBottom: 4 }}>FCCTV AI</div>}
        {text}
        {at && <div className="muted" style={{ fontSize: 11, marginTop: 4 }}>{timeIST(at)}</div>}
      </div>
    </div>
  );
}
