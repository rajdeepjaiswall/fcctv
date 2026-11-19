import { sql } from "@/lib/db";
import { admin, json } from "@/lib/http";
import { signedUrl } from "@/lib/r2";

export const dynamic = "force-dynamic";

/** Everything the live grid needs, polled every couple of seconds. */
export const GET = admin(async () => {
  const rows = (await sql`
    select w.id, w.name, w.active, d.id as device_id, d.mode, d.live_requested, d.battery, d.charging, d.phone_battery,
           d.status_detail, d.last_seen, d.last_frame_at, d.latest_frame_key, d.paired_at, d.pair_code, d.glasses_name, d.duty_requested, d.capture_mode, d.active_session_id
    from workers w left join devices d on d.worker_id = w.id
    order by w.created_at`) as Record<string, unknown>[];
  const out = await Promise.all(rows.map(async (r) => ({
    ...r,
    frame_url: r.latest_frame_key ? await signedUrl(String(r.latest_frame_key), 300) : null,
  })));
  return json({ workers: out, now: new Date().toISOString() });
});
