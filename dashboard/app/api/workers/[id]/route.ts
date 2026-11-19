import { sql } from "@/lib/db";
import { admin, json } from "@/lib/http";
import { pairCode } from "@/lib/auth";
import { signedUrl, deleteObject } from "@/lib/r2";

export const dynamic = "force-dynamic";
type Ctx = { params: Promise<{ id: string }> };

/** Worker detail: device status, latest frame, sessions, snapshots for a day, recent events. */
export const GET = admin(async (req: Request, ctx: Ctx) => {
  const { id } = await ctx.params;
  const url = new URL(req.url);
  const day = /^\d{4}-\d{2}-\d{2}$/.test(url.searchParams.get("day") ?? "") ? url.searchParams.get("day")! : null;
  const w = (await sql`select * from workers where id = ${id}`) as Record<string, unknown>[];
  if (!w[0]) return json({ error: "Worker not found" }, 404);
  const d = (await sql`select id, mode, live_requested, battery, charging, phone_battery, status_detail, last_seen, last_frame_at,
      latest_frame_key, paired_at, pair_code, pair_expires_at, consent_at, consent_name, glasses_name, glasses_mac, app_version, duty_requested, capture_mode, active_session_id
      from devices where worker_id = ${id}`) as Record<string, unknown>[];
  const dev = d[0] ?? null;
  const sessions = await sql`select id, mode, status, started_at, ended_at, snapshots, summary from sessions where worker_id = ${id} order by started_at desc limit 30`;
  // Snapshots for one day in IST (default today).
  const snaps = (day
    ? await sql`select id, key, source, battery, taken_at from snapshots where worker_id = ${id}
        and (taken_at at time zone 'Asia/Kolkata')::date = ${day}::date order by taken_at desc limit 400`
    : await sql`select id, key, source, battery, taken_at from snapshots where worker_id = ${id}
        and (taken_at at time zone 'Asia/Kolkata')::date = (now() at time zone 'Asia/Kolkata')::date order by taken_at desc limit 400`
  ) as { id: string; key: string }[];
  const events = await sql`select * from events where worker_id = ${id} order by created_at desc limit 50`;
  return json({
    worker: w[0],
    device: dev ? { ...dev, frame_url: dev.latest_frame_key ? await signedUrl(String(dev.latest_frame_key), 300) : null } : null,
    sessions,
    snapshots: await Promise.all(snaps.map(async (s) => ({ ...s, url: await signedUrl(s.key, 3600) }))),
    events,
  });
});

/** Actions: { live: true|false } | { newPairCode: true } | { active: bool } | { name } */
export const PATCH = admin(async (req: Request, ctx: Ctx) => {
  const { id } = await ctx.params;
  const b = await req.json().catch(() => ({}));
  if (typeof b.live === "boolean") {
    await sql`update devices set live_requested = ${b.live} where worker_id = ${id}`;
    await sql`insert into events (worker_id, type, message) values (${id}, ${b.live ? "live_on" : "live_off"},
      ${b.live ? "Owner turned on live video" : "Owner turned off live video"})`;
  }
  if (typeof b.active === "boolean") await sql`update workers set active = ${b.active} where id = ${id}`;
  if (typeof b.name === "string" && b.name.trim()) await sql`update workers set name = ${b.name.trim().slice(0, 80)} where id = ${id}`;
  if (b.newPairCode) {
    const code = pairCode();
    const n = (await sql`update devices set pair_code = ${code}, pair_expires_at = now() + interval '24 hours', token_hash = null
      where worker_id = ${id} returning id`) as unknown[];
    if (!n.length) await sql`insert into devices (worker_id, pair_code, pair_expires_at) values (${id}, ${code}, now() + interval '24 hours')`;
    return json({ ok: true, pair_code: code });
  }
  return json({ ok: true });
});

export const DELETE = admin(async (_req: Request, ctx: Ctx) => {
  const { id } = await ctx.params;
  const keys = (await sql`select key from snapshots where worker_id = ${id}`) as { key: string }[];
  for (const k of keys) await deleteObject(k.key);
  const devs = (await sql`select id from devices where worker_id = ${id}`) as { id: string }[];
  for (const d of devs) await deleteObject(`live/${d.id}.jpg`);
  await sql`delete from workers where id = ${id}`;
  return json({ ok: true });
});
