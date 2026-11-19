"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import Shell from "@/components/Shell";
import { api, ago, liveStatus, type WorkerRow } from "@/lib/client";

export default function Workers() {
  const [rows, setRows] = useState<WorkerRow[]>([]);
  const [name, setName] = useState("");
  const [created, setCreated] = useState<{ name: string; code: string } | null>(null);
  const [error, setError] = useState("");

  const load = () => api<{ workers: WorkerRow[] }>("/api/overview").then((r) => setRows(r.workers)).catch((e) => setError(e.message));
  useEffect(() => { load(); }, []);

  const add = async (e: React.FormEvent) => {
    e.preventDefault(); setError("");
    try {
      const r = await api<{ pair_code: string }>("/api/workers", { method: "POST", body: JSON.stringify({ name }) });
      setCreated({ name, code: r.pair_code }); setName(""); load();
    } catch (err) { setError((err as Error).message); }
  };

  return (
    <Shell>
      <h1>Workers</h1>
      <form className="card card-body" onSubmit={add} style={{ marginBottom: 16 }}>
        <div className="field"><label htmlFor="n">Add a worker</label>
          <input id="n" className="input" placeholder="Worker's name" value={name} onChange={(e) => setName(e.target.value)} /></div>
        <button className="btn" disabled={!name.trim()}>Add worker and get pairing code</button>
        {error && <div className="alert" style={{ marginTop: 12 }}>{error}</div>}
        {created && (
          <div style={{ marginTop: 14 }}>
            <p>Pairing code for <b>{created.name}</b>:</p>
            <span className="code">{created.code}</span>
            <p className="muted small">On the worker&apos;s phone: open FCCTV → agree to the notice → type this code. Valid for 24 hours, works once.</p>
          </div>
        )}
      </form>
      <ul className="list">
        {rows.map((w) => {
          const st = liveStatus(w);
          return (
            <li key={w.id} className="row spread">
              <span><Link href={`/worker/${w.id}`}><b>{w.name}</b></Link>{!w.active && <span className="muted small"> (inactive)</span>}
                <br /><span className="muted small">{w.paired_at ? `Last seen ${ago(w.last_seen)}` : w.pair_code ? `Pairing code: ${w.pair_code}` : "Not paired"}</span></span>
              <span className={`badge ${st.cls}`}><span className="dot" />{st.label}</span>
            </li>
          );
        })}
      </ul>
    </Shell>
  );
}
