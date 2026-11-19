"use client";
import { useEffect, useState } from "react";
import Shell from "@/components/Shell";
import { api } from "@/lib/client";

type S = {
  snapshot_interval_sec: number; live_fps: number; retention_days: number; enforce_hours: boolean; work_start: string; work_end: string; timezone: string;
  r2_account_id: string | null; r2_bucket: string | null; r2_access_key_hint: string | null; r2_has_secret: boolean;
};

export default function Settings() {
  const [s, setS] = useState<S | null>(null);
  const [r2, setR2] = useState(true);
  const [msg, setMsg] = useState("");
  const [error, setError] = useState("");
  const [keyId, setKeyId] = useState("");
  const [secretKey, setSecretKey] = useState("");

  useEffect(() => { api<{ settings: S; r2: boolean }>("/api/settings").then((r) => { setS(r.settings); setR2(r.r2); }).catch((e) => setError(e.message)); }, []);
  if (!s) return <Shell>{error ? <div className="alert">{error}</div> : <p className="muted">Loading…</p>}</Shell>;
  const set = (k: keyof S, v: unknown) => setS({ ...s, [k]: v });

  const save = async (e: React.FormEvent, testR2 = false) => {
    e.preventDefault(); setMsg(""); setError("");
    try {
      const r = await api<{ settings: S; r2: boolean; r2Error: string | null; r2Tested: boolean }>("/api/settings", {
        method: "PUT", body: JSON.stringify({ ...s, r2_access_key: keyId, r2_secret_key: secretKey, testR2 }),
      });
      setS(r.settings); setR2(r.r2); setKeyId(""); setSecretKey("");
      if (r.r2Tested && r.r2Error) setError(`Saved, but the photo storage test failed: ${r.r2Error}`);
      else setMsg(r.r2Tested ? "Saved. Photo storage works ✓" : "Saved. Phones pick this up within a few seconds.");
    } catch (err) { setError((err as Error).message); }
  };

  return (
    <Shell>
      <h1>Settings</h1>
      {!r2 && <div className="alert">Photo storage isn&apos;t connected yet — fill in the Cloudflare R2 section below.</div>}
      <form className="card card-body" onSubmit={(e) => save(e)} style={{ maxWidth: 560 }}>
        <div className="field"><label htmlFor="i">Snapshot every</label>
          <select id="i" className="input" value={s.snapshot_interval_sec} onChange={(e) => set("snapshot_interval_sec", Number(e.target.value))}>
            {[5, 10, 15, 30, 60, 120, 300].map((n) => <option key={n} value={n}>{n < 60 ? `${n} seconds` : `${n / 60} minute${n > 60 ? "s" : ""}`}</option>)}
          </select></div>
        <div className="field"><label htmlFor="f">Live video speed</label>
          <select id="f" className="input" value={s.live_fps} onChange={(e) => set("live_fps", Number(e.target.value))}>
            {[1, 2, 3, 4, 5].map((n) => <option key={n} value={n}>{n} picture{n > 1 ? "s" : ""} per second</option>)}
          </select></div>
        <div className="field"><label htmlFor="r">Keep photos for</label>
          <select id="r" className="input" value={s.retention_days} onChange={(e) => set("retention_days", Number(e.target.value))}>
            {[1, 3, 7, 15, 30, 60, 90, 180, 365].map((n) => <option key={n} value={n}>{n} day{n > 1 ? "s" : ""}</option>)}
          </select></div>
        <div className="field">
          <label><input type="checkbox" checked={s.enforce_hours} onChange={(e) => set("enforce_hours", e.target.checked)} /> Only capture during working hours (India time)</label>
          <div className="row">
            <input className="input" type="time" value={s.work_start} onChange={(e) => set("work_start", e.target.value)} disabled={!s.enforce_hours} />
            <span>to</span>
            <input className="input" type="time" value={s.work_end} onChange={(e) => set("work_end", e.target.value)} disabled={!s.enforce_hours} />
          </div>
        </div>
        <h2>Photo storage (Cloudflare R2)</h2>
        <p className="muted small">{r2 ? `Connected · bucket ${s.r2_bucket ?? "fcctv-frames"} · key ${s.r2_access_key_hint ?? "(from server)"}` : "Not connected yet. Paste your R2 details, then tap Save & test."}</p>
        <div className="field"><label htmlFor="ra">Account ID</label>
          <input id="ra" className="input" value={s.r2_account_id ?? ""} onChange={(e) => set("r2_account_id", e.target.value)} autoComplete="off" /></div>
        <div className="field"><label htmlFor="rb">Bucket name</label>
          <input id="rb" className="input" placeholder="fcctv-frames" value={s.r2_bucket ?? ""} onChange={(e) => set("r2_bucket", e.target.value)} autoComplete="off" /></div>
        <div className="field"><label htmlFor="rk">Access Key ID {s.r2_access_key_hint && <span className="muted small">(saved {s.r2_access_key_hint}; leave empty to keep)</span>}</label>
          <input id="rk" className="input" value={keyId} onChange={(e) => setKeyId(e.target.value)} autoComplete="off" /></div>
        <div className="field"><label htmlFor="rs">Secret Access Key {s.r2_has_secret && <span className="muted small">(saved; leave empty to keep)</span>}</label>
          <input id="rs" className="input" type="password" value={secretKey} onChange={(e) => setSecretKey(e.target.value)} autoComplete="new-password" /></div>
        <button type="button" className="btn ghost" style={{ marginBottom: 14 }} onClick={(e) => save(e, true)}>Save &amp; test photo storage</button>
        {msg && <div className="ok">{msg}</div>}
        {error && <div className="alert">{error}</div>}
        <button className="btn">Save settings</button>
      </form>
      <p className="muted small" style={{ marginTop: 16 }}>AI analysis (Gemini key, phone-use alerts, custom rules, summaries) arrives in Phase 3.5.</p>
    </Shell>
  );
}
