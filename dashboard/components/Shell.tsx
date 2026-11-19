"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { api } from "@/lib/client";

export default function Shell({ children }: { children: React.ReactNode }) {
  const path = usePathname();
  const on = (p: string) => (p === "/" ? path === "/" : path.startsWith(p)) ? "on" : "";
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
            <Link href="/workers" className={on("/workers")}>Workers</Link>
            <Link href="/settings" className={on("/settings")}>Settings</Link>
            <button onClick={async () => { await api("/api/auth/logout", { method: "POST" }); window.location.href = "/login"; }}>Log out</button>
          </nav>
        </div>
      </header>
      <main className="page">{children}</main>
    </>
  );
}
