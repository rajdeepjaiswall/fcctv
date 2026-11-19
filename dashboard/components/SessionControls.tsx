"use client";
import Link from "next/link";
import { useState } from "react";
import { api } from "@/lib/client";

type Props = {
  workerId: string;
  paired: boolean;
  online: boolean;
  sessionId: string | null;
  mode: string | null;
  liveRequested: boolean;
  onChange?: () => void;
};

/** Start a photo or video session, stop it (which starts the AI analysis), and toggle the live view. */
export default function SessionControls({ workerId, paired, online, sessionId, mode, liveRequested, onChange }: Props) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  if (!paired) return <span className="muted small">Pair the phone first (Workers page).</span>;

  const run = async (body: object, path = "session") => {
    setBusy(true); setErr("");
    try { await api(`/api/workers/${workerId}${path === "session" ? "/session" : ""}`, { method: path === "session" ? "POST" : "PATCH", body: JSON.stringify(body) }); onChange?.(); }
    catch (e) { setErr((e as Error).message); }
    finally { setBusy(false); }
  };

  return (
    <div>
      <div className="row">
        {sessionId ? (
          <>
            <button className="btn brown" disabled={busy} onClick={() => run({ action: "stop" })}>■ Stop &amp; analyse</button>
            <Link className="btn ghost" href={`/session/${sessionId}`}>Open session</Link>
          </>
        ) : (
          <>
            <button className="btn" disabled={busy} onClick={() => run({ action: "start", mode: "images" })}>▶ Start photos</button>
            <button className="btn" disabled={busy} onClick={() => run({ action: "start", mode: "video" })}>▶ Start video</button>
          </>
        )}
        <button className={`btn ${liveRequested ? "brown" : "ghost"}`} disabled={busy} onClick={() => run({ live: !liveRequested }, "patch")}>
          {liveRequested ? "Close live feed" : "Live feed"}
        </button>
      </div>
      {liveRequested && (
        <p className="small" style={{ margin: "6px 0 0" }}>
          <b>Live feed is on.</b> You&apos;re seeing the glasses camera directly; nothing is saved.
          {sessionId ? " The session is paused and its photos continue when you close the live feed." : ""}
        </p>
      )}
      {sessionId && !liveRequested && <p className="muted small" style={{ margin: "6px 0 0" }}>Recording {mode === "video" ? "video" : "photos"}{!online ? " — phone is offline, it will start when it reconnects" : ""}.</p>}
      {!sessionId && !online && <p className="muted small" style={{ margin: "6px 0 0" }}>Phone is offline. The worker must open FCCTV and tap “Be ready”.</p>}
      {err && <div className="alert" style={{ marginTop: 8 }}>{err}</div>}
    </div>
  );
}
