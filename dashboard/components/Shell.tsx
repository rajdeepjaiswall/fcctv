"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { api } from "@/lib/client";

/** Short two-tone beep (no audio file needed). */
function beep() {
  try {
    const ctx = new AudioContext();
    [880, 660].forEach((f, i) => {
      const o = ctx.createOscillator(); const g = ctx.createGain();
      o.frequency.value = f; o.connect(g); g.connect(ctx.destination);
      g.gain.setValueAtTime(0.15, ctx.currentTime + i * 0.18);
      o.start(ctx.currentTime + i * 0.18); o.stop(ctx.currentTime + i * 0.18 + 0.15);
    });
  } catch { /* browser blocked audio */ }
}

export default function Shell({ children }: { children: React.ReactNode }) {
  const path = usePathname();
  const on = (p: string) => (p === "/" ? path === "/" : path.startsWith(p)) ? "on" : "";
  const [unseen, setUnseen] = useState(0);
  const [toast, setToast] = useState<string | null>(null);
  const lastId = useRef<string | null | undefined>(undefined);

  useEffect(() => {
    if ("serviceWorker" in navigator) navigator.serviceWorker.register("/sw.js").catch(() => undefined);
    let stop = false;
    const load = async () => {
      try {
        const r = await api<{ n: number; latest_id: string | null; latest_text: string | null }>("/api/alerts/count");
        if (stop) return;
        setUnseen(r.n);
        if (lastId.current !== undefined && r.latest_id && r.latest_id !== lastId.current) {
          setToast(`⚠ ${r.latest_text ?? "New alert"}`); beep();
          setTimeout(() => setToast(null), 8000);
        }
        lastId.current = r.latest_id;
      } catch { /* offline */ }
    };
    load();
    const t = setInterval(load, 8000);
    return () => { stop = true; clearInterval(t); };
  }, []);

  return (
    <>
      <header className="topbar">
        <div className="topbar-inner">
          <Link href="/" className="brand">
            <img src="/logo-icon.png" alt="Getdown Foundation" />
            <span><b>FCCTV</b><small>by Get Down Foundation</small></span>
          </Link>
          <nav className="nav">
            <Link href="/" className={on("/")}>Live</Link>
            <Link href="/alerts" className={on("/alerts")}>Alerts{unseen > 0 && <span className="count">{unseen > 99 ? "99+" : unseen}</span>}</Link>
            <Link href="/workers" className={on("/workers")}>Workers</Link>
            <Link href="/settings" className={on("/settings")}>Settings</Link>
            <button onClick={async () => { await api("/api/auth/logout", { method: "POST" }); window.location.href = "/login"; }}>Log out</button>
          </nav>
        </div>
      </header>
      {toast && <Link href="/alerts" className="toast" onClick={() => setToast(null)}>{toast}</Link>}
      <main className="page">{children}</main>
    </>
  );
}
