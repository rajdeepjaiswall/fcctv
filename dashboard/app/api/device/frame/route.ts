import { sql } from "@/lib/db";
import { json, device } from "@/lib/http";
import { putJpeg, r2Configured } from "@/lib/r2";

export const dynamic = "force-dynamic";
const MAX = 3 * 1024 * 1024;
const UUID = /^[0-9a-f-]{36}$/i;

/**
 * Body: raw JPEG. Headers: x-kind live|snapshot, x-source photo|live, x-session, x-battery, x-taken-at (ms).
 * Live frames overwrite one object per phone; snapshots are kept (until the retention period ends).
 */
export const POST = device(async (req, dev) => {
  if (!(await r2Configured())) return json({ error: "Photo storage (R2) not configured on the server yet." }, 503);
  const jpeg = new Uint8Array(await req.arrayBuffer());
  if (jpeg.length < 500 || jpeg.length > MAX || jpeg[0] !== 0xff || jpeg[1] !== 0xd8) return json({ error: "not a JPEG" }, 400);
  const live = req.headers.get("x-kind") === "live";
  const battery = Number.parseInt(req.headers.get("x-battery") ?? "", 10);
  const bat = Number.isFinite(battery) ? battery : null;
  const sessionHeader = req.headers.get("x-session") ?? "";
  const sessionId = UUID.test(sessionHeader) ? sessionHeader : null;
  const t = Number(req.headers.get("x-taken-at"));
  const takenAt = new Date(Number.isFinite(t) && t > 1.6e12 && t < Date.now() + 60_000 ? t : Date.now());

  let key = `live/${dev.id}.jpg`;
  let snapshotId: string | null = null;
  if (!live) {
    key = `snaps/${dev.worker_id}/${takenAt.toISOString().slice(0, 10)}/${takenAt.getTime()}-${crypto.randomUUID().slice(0, 6)}.jpg`;
  }
  await putJpeg(key, jpeg);
  if (!live) {
    const rows = (await sql`
      insert into snapshots (worker_id, device_id, session_id, key, source, battery, bytes, taken_at)
      values (${dev.worker_id}, ${dev.id}, ${sessionId}, ${key}, ${req.headers.get("x-source") === "live" ? "live" : "photo"},
              ${bat}, ${jpeg.length}, ${takenAt.toISOString()})
      returning id`) as { id: string }[];
    snapshotId = rows[0].id;
    if (sessionId) await sql`update sessions set snapshots = snapshots + 1 where id = ${sessionId} and device_id = ${dev.id}`;
  }
  await sql`
    update devices set last_frame_at = ${takenAt.toISOString()}, latest_frame_key = ${key}, last_seen = now(),
      battery = coalesce(${bat}, battery)
    where id = ${dev.id}`;
  return json({ ok: true, snapshot_id: snapshotId });
});
