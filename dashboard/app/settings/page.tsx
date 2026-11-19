"use client";
import { useEffect, useState } from "react";
import Shell from "@/components/Shell";
import AlertActions from "@/components/AlertActions";
import { api } from "@/lib/client";

type S = {
  snapshot_interval_sec: number; live_fps: number; retention_days: number; enforce_hours: boolean; work_start: string; work_end: string; timezone: string;
  r2_account_id: string | null; r2_bucket: string | null; r2_access_key_hint: string | null; r2_has_secret: boolean;
  gemini_key_hint: string | null; ai_model: string; ai_language: string; summary_batch: number; auto_analyse: boolean;
  default_capture_mode: string; video_save_every_sec: number;
  ai_models: string | null; detection_enabled: boolean; check_every_sec: number;
};

export default function Settings() {
  const [s, setS] = useState<S | null>(null);
  const [r2, setR2] = useState(true);
  const [msg, setMsg] = useState("");
  const [error, setError] = useState("");
  const [keyId, setKeyId] = useState("");
  const [secretKey, setSecretKey] = useState("");
  const [geminiKey, setGeminiKey] = useState("");
  const [models, setModels] = useState<string[]>([]);
  const [aiMsg, setAiMsg] = useState("");
  const [aiErr, setAiErr] = useState("");
  const [testing, setTesting] = useState(false);

  useEffect(() => { api<{ settings: S; r2: boolean }>("/api/settings").then((r) => { setS(r.settings); setR2(r.r2); }).catch((e) => setError(e.message)); }, []);
  if (!s) return <Shell>{error ? <div className="alert">{error}</div> : <p className="muted">Loading…</p>}</Shell>;
  const set = (k: keyof S, v: unknown) => setS({ ...s, [k]: v });

  const save = async (e: React.FormEvent, testR2 = false) => {
    e.preventDefault(); setMsg(""); setError("");
    try {
      const r = await api<{ settings: S; r2: boolean; r2Error: string | null; r2Tested: boolean }>("/api/settings", {
        method: "PUT", body: JSON.stringify({ ...s, r2_access_key: keyId, r2_secret_key: secretKey, gemini_api_key: geminiKey, testR2 }),
      });
      setS(r.settings); setR2(r.r2); setKeyId(""); setSecretKey(""); setGeminiKey("");
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
        <h2>Capture</h2>
        <div className="field"><label htmlFor="cm">Default for “Start”</label>
          <select id="cm" className="input" value={s.default_capture_mode} onChange={(e) => set("default_capture_mode", e.target.value)}>
            <option value="images">Photos (light on battery)</option>
            <option value="video">Video (live video; heavy on battery)</option>
          </select></div>
        <div className="field"><label htmlFor="vs">In video mode, keep a frame for the timeline every</label>
          <select id="vs" className="input" value={s.video_save_every_sec} onChange={(e) => set("video_save_every_sec", Number(e.target.value))}>
            {[1, 2, 3, 5, 10, 15, 30].map((n) => <option key={n} value={n}>{n} second{n > 1 ? "s" : ""}</option>)}
          </select></div>

        <h2>AI analysis (Google Gemini)</h2>
        <p className="muted small">The key stays on the server and is never sent to workers&apos; phones. Get one at aistudio.google.com → Get API key.</p>
        <div className="field"><label htmlFor="gk">Gemini API key {s.gemini_key_hint && <span className="muted small">(saved {s.gemini_key_hint}; leave empty to keep)</span>}</label>
          <input id="gk" className="input" type="password" value={geminiKey} onChange={(e) => setGeminiKey(e.target.value)} autoComplete="off" /></div>
        <div className="field"><label htmlFor="am">Model</label>
          <input id="am" className="input" list="models" value={s.ai_model} onChange={(e) => set("ai_model", e.target.value)} />
          <datalist id="models">{models.map((m) => <option key={m} value={m} />)}</datalist>
          {models.length > 0 && <span className="muted small">Your key can use: {models.slice(0, 8).join(", ")}{models.length > 8 ? "…" : ""}</span>}
        </div>
        <button type="button" className="btn ghost" style={{ marginBottom: 14 }} disabled={testing} onClick={async (e) => {
          setTesting(true); setAiMsg(""); setAiErr("");
          try {
            await save(e);
            const r = await api<{ ok: boolean; models: string[]; reply?: string; error?: string }>("/api/settings/ai-test", { method: "POST", body: "{}" });
            setModels(r.models ?? []);
            if (r.ok) setAiMsg(`Key works ✓ (${s.ai_model} replied “${r.reply}”)`); else setAiErr(r.error ?? "Test failed");
          } catch (err) { setAiErr((err as Error).message); }
          setTesting(false);
        }}>{testing ? "Testing…" : "Save & test key"}</button>
        {aiMsg && <div className="ok">{aiMsg}</div>}
        {aiErr && <div className="alert">{aiErr}{models.length > 0 ? " — pick a model from the list above and test again." : ""}</div>}
        {models.length > 1 && (
          <div className="field"><label>Backup models (used automatically when the main one is busy)</label>
            <div className="row" style={{ gap: 6 }}>
              {models.filter((m) => m !== s.ai_model).slice(0, 10).map((m) => {
                const list = (s.ai_models ?? "").split(",").map((x) => x.trim()).filter(Boolean);
                const on = list.includes(m);
                return <button key={m} type="button" className={`btn small ${on ? "" : "ghost"}`}
                  onClick={() => set("ai_models", (on ? list.filter((x) => x !== m) : [...list, m]).join(","))}>{on ? "✓ " : ""}{m}</button>;
              })}
            </div>
            <span className="muted small">Even with none picked, FCCTV tries your other Flash models before giving up, and retries busy work later instead of showing an error.</span>
          </div>
        )}
        <div className="field">
          <label><input type="checkbox" checked={s.detection_enabled} onChange={(e) => set("detection_enabled", e.target.checked)} /> Check photos for alert actions while recording</label>
        </div>
        <div className="field"><label htmlFor="ce">Check for alerts at most every</label>
          <select id="ce" className="input" value={s.check_every_sec} onChange={(e) => set("check_every_sec", Number(e.target.value))}>
            {[5, 10, 15, 30, 60].map((n) => <option key={n} value={n}>{n} seconds</option>)}
          </select></div>
        <div className="field">
          <label><input type="checkbox" checked={s.auto_analyse} onChange={(e) => set("auto_analyse", e.target.checked)} /> Analyse automatically (timeline notes while recording, summary when stopped)</label>
        </div>
        <div className="field"><label htmlFor="sb">Write a timeline note every</label>
          <select id="sb" className="input" value={s.summary_batch} onChange={(e) => set("summary_batch", Number(e.target.value))}>
            {[5, 10, 15, 20, 30, 60].map((n) => <option key={n} value={n}>{n} photos</option>)}
          </select></div>
        <div className="field"><label htmlFor="al">AI language</label>
          <select id="al" className="input" value={s.ai_language} onChange={(e) => set("ai_language", e.target.value)}>
            <option value="en">English</option><option value="hi">हिन्दी (Hindi)</option>
          </select></div>

        {msg && <div className="ok">{msg}</div>}
        {error && <div className="alert">{error}</div>}
        <button className="btn">Save settings</button>
      </form>
      <AlertActions />
    </Shell>
  );
}
