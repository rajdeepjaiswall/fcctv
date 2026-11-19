"use client";
import { useEffect, useState } from "react";
import { api } from "@/lib/client";

type Status = { db: boolean; r2: boolean; needsSetup: boolean; loggedIn: boolean };

export default function Login() {
  const [status, setStatus] = useState<Status | null>(null);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api<Status>("/api/auth/status").then((s) => { if (s.loggedIn) window.location.href = "/"; else setStatus(s); })
      .catch((e) => setError(e.message));
  }, []);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault(); setBusy(true); setError("");
    try {
      await api(status?.needsSetup ? "/api/auth/setup" : "/api/auth/login", { method: "POST", body: JSON.stringify({ email, password }) });
      window.location.href = "/";
    } catch (err) { setError((err as Error).message); setBusy(false); }
  };

  return (
    <div className="login-wrap">
      <form className="login-card" onSubmit={submit}>
        <img className="logo" src="/logo-icon.png" alt="Getdown Foundation logo" />
        <h1>FCCTV</h1>
        <p className="by">by Get Down Foundation</p>
        {status && !status.db && <div className="alert">Database not connected yet. In Vercel, open project fcctv → Storage → connect Neon.</div>}
        {status && status.db && !status.r2 && <div className="alert">Photo storage (Cloudflare R2) isn&apos;t set up yet; photos won&apos;t save until it is.</div>}
        {status?.needsSetup && <div className="ok">First time here: create the owner account. Only this account can open the dashboard.</div>}
        <div className="field"><label htmlFor="e">Email</label>
          <input id="e" className="input" type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required /></div>
        <div className="field"><label htmlFor="p">Password</label>
          <input id="p" className="input" type="password" autoComplete={status?.needsSetup ? "new-password" : "current-password"}
            minLength={status?.needsSetup ? 8 : undefined} value={password} onChange={(e) => setPassword(e.target.value)} required /></div>
        {error && <div className="alert">{error}</div>}
        <button className="btn block" disabled={busy || !status?.db}>{status?.needsSetup ? "Create owner account" : "Log in"}</button>
      </form>
    </div>
  );
}
