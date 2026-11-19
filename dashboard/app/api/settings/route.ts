import { sql, getSettings, type Settings } from "@/lib/db";
import { admin, json } from "@/lib/http";
import { r2Configured, clearR2Cache, testR2 } from "@/lib/r2";

export const dynamic = "force-dynamic";

/** Never send secret keys back to the browser. */
function publicView(s: Settings) {
  const { r2_secret_key, r2_access_key, ...rest } = s;
  return {
    ...rest,
    r2_access_key_hint: r2_access_key ? `…${r2_access_key.slice(-4)}` : null,
    r2_has_secret: !!r2_secret_key,
  };
}

export const GET = admin(async () => json({ settings: publicView(await getSettings()), r2: await r2Configured() }));

export const PUT = admin(async (req: Request) => {
  const b = await req.json().catch(() => ({}));
  const int = (v: unknown, lo: number, hi: number, d: number) => {
    const n = Math.round(Number(v)); return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : d;
  };
  const time = (v: unknown, d: string) => (typeof v === "string" && /^\d{2}:\d{2}$/.test(v) ? v : d);
  const text = (v: unknown, d: string | null) => (typeof v === "string" && v.trim() ? v.trim().slice(0, 200) : d);
  const cur = await getSettings();
  await sql`update settings set
    snapshot_interval_sec = ${int(b.snapshot_interval_sec, 3, 600, cur.snapshot_interval_sec)},
    live_fps = ${int(b.live_fps, 1, 5, cur.live_fps)},
    retention_days = ${int(b.retention_days, 1, 365, cur.retention_days)},
    enforce_hours = ${typeof b.enforce_hours === "boolean" ? b.enforce_hours : cur.enforce_hours},
    work_start = ${time(b.work_start, cur.work_start)}, work_end = ${time(b.work_end, cur.work_end)},
    r2_account_id = ${text(b.r2_account_id, cur.r2_account_id)},
    r2_access_key = ${text(b.r2_access_key, cur.r2_access_key)},
    r2_secret_key = ${text(b.r2_secret_key, cur.r2_secret_key)},
    r2_bucket = ${text(b.r2_bucket, cur.r2_bucket)},
    updated_at = now() where id = 1`;
  clearR2Cache();
  const r2Error = b.testR2 ? await testR2() : null;
  return json({ settings: publicView(await getSettings()), r2: await r2Configured(), r2Error, r2Tested: !!b.testR2 });
});
