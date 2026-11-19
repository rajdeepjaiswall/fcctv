"use client";
import Link from "next/link";
import { useState } from "react";
import { api, ago, timeIST, dateTimeIST } from "@/lib/client";

export type SessionRow = {
  id: string; mode: string; status: string; started_at: string; ended_at: string | null; summary: string | null; summary_at: string | null;
  snapshots: number; alerts: number; cover: string | null; ai_error: string | null;
};
type Step = { state: string; notes: number; total: number; analysed?: number; error?: string };

/** One session as a card: cover photo, times, counts, and "AI analyse" which reads every frame and writes the summary. */
export default function SessionCard({ s, now, onDone }: { s: SessionRow; now: number; onDone?: () => void }) {
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [msg, setMsg] = useState("");
  const [summary, setSummary] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);
  const text = summary ?? s.summary;
  const recording = s.status === "recording" && !s.ended_at;

  const analyse = async (again: boolean) => {
    setRunning(true); setMsg(""); setExpanded(true);
    let first = true;
    try {
      for (let i = 0; i < 400; i++) {
        const r = await api<Step>(`/api/sessions/${s.id}/analyse`, { method: "POST", body: JSON.stringify(first && again ? { restart: true } : { full: true }) });
        first = false;
        setProgress({ done: r.analysed ?? 0, total: r.total });
        if (r.state === "done") break;
        if (r.state === "failed") { setMsg(r.error ?? "Analysis failed"); break; }
        if (r.state === "busy") { setMsg("AI is busy — still trying…"); await new Promise((x) => setTimeout(x, 4000)); continue; }
        setMsg("");
      }
      const d = await api<{ session: { summary: string | null } }>(`/api/sessions/${s.id}`);
      setSummary(d.session.summary);
      onDone?.();
    } catch (e) { setMsg((e as Error).message); }
    setRunning(false);
  };

  const badge = recording ? ["live", "Recording"] : s.status === "analysing" ? ["warn", "Analysing"] : text ? ["snap", "Summary ready"] : ["off", "Ended"];
  const pct = progress && progress.total ? Math.round((progress.done / progress.total) * 100) : 0;

  return (
    <div className="card">
      <Link href={`/session/${s.id}`} className="frame">
        {s.cover ? <img src={s.cover} alt="Session photo" loading="lazy" /> : <span className="muted">No frames yet</span>}
        <span className={`badge ${badge[0]}`}><span className="dot" />{badge[1]}</span>
        <span className="age">{ago(s.ended_at ?? s.started_at, now)}</span>
      </Link>
      <div className="card-body">
        <div className="row spread">
          <b>{dateTimeIST(s.started_at)} → {s.ended_at ? timeIST(s.ended_at) : "now"}</b>
        </div>
        <div className="row" style={{ gap: 6, margin: "6px 0" }}>
          <span className="chip">{s.mode === "video" ? "🎥 Video" : "📷 Photos"}</span>
          <span className="chip">{s.snapshots} frames</span>
          {s.alerts > 0 && <span className="chip">⚠ {s.alerts} alert{s.alerts > 1 ? "s" : ""}</span>}
        </div>

        {running && (
          <div>
            <div className="small">Looking through {progress?.total ?? s.snapshots} frames… {progress ? `${progress.done}/${progress.total}` : ""}</div>
            <div className="progress"><div style={{ width: `${pct}%` }} /></div>
          </div>
        )}
        {msg && <div className="small" style={{ marginTop: 6, color: "var(--muddy-brown)" }}>{msg}</div>}
        {text && (
          <div className="summary-box" onClick={() => setExpanded(!expanded)}>
            {expanded || text.length < 260 ? text : `${text.slice(0, 260)}… (tap to read more)`}
          </div>
        )}

        <div className="row" style={{ marginTop: 10 }}>
          <button className="btn" disabled={running || s.snapshots === 0} onClick={() => analyse(!!text && !recording)}>
            {running ? "Analysing…" : text ? (recording ? "✨ AI analyse again" : "✨ Analyse again") : "✨ AI analyse"}
          </button>
          <Link className="btn ghost" href={`/session/${s.id}`}>Open · chat</Link>
        </div>
      </div>
    </div>
  );
}
