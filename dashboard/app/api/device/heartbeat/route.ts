import { sql, getSettings, withinHours } from "@/lib/db";
import { json, device } from "@/lib/http";

export const dynamic = "force-dynamic";

/** Phone reports status every few seconds; we answer with what it should be doing. */
export const POST = device(async (req, dev) => {
  const b = await req.json().catch(() => ({}));
  const s = await getSettings();
  const inHours = withinHours(s);
  const mode = ["off", "snapshot", "live", "paused"].includes(b.mode) ? b.mode : "off";
  const rows = (await sql`
    update devices set last_seen = now(), mode = ${mode},
      battery = ${b.battery ?? null}, charging = ${b.charging ?? null}, phone_battery = ${b.phone_battery ?? null},
      status_detail = ${typeof b.detail === "string" ? b.detail.slice(0, 200) : null},
      glasses_name = ${b.glasses_name ?? null}, glasses_mac = ${b.glasses_mac ?? null}, app_version = ${b.app_version ?? null}
    where id = ${dev.id} returning live_requested`) as { live_requested: boolean }[];
  return json({
    worker_name: dev.worker_name,
    active: dev.active,
    live_requested: !!rows[0]?.live_requested && inHours && dev.active,
    snapshot_interval_sec: s.snapshot_interval_sec,
    live_fps: s.live_fps,
    within_hours: inHours,
    work_start: s.work_start, work_end: s.work_end,
  });
});
