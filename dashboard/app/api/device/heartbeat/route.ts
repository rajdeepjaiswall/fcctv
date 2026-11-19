import { sql, getSettings, withinHours } from "@/lib/db";
import { json, device } from "@/lib/http";

export const dynamic = "force-dynamic";

/** Phone reports status every few seconds; we answer with what it should be doing. */
export const POST = device(async (req, dev) => {
  const b = await req.json().catch(() => ({}));
  const s = await getSettings();
  const inHours = withinHours(s);
  const mode = ["off", "standby", "snapshot", "live", "paused"].includes(b.mode) ? b.mode : "off";
  const rows = (await sql`
    update devices set last_seen = now(), mode = ${mode},
      battery = ${b.battery ?? null}, charging = ${b.charging ?? null}, phone_battery = ${b.phone_battery ?? null},
      status_detail = ${typeof b.detail === "string" ? b.detail.slice(0, 200) : null},
      glasses_name = ${b.glasses_name ?? null}, glasses_mac = ${b.glasses_mac ?? null}, app_version = ${b.app_version ?? null}
    where id = ${dev.id} returning live_requested, duty_requested, capture_mode, active_session_id`) as {
      live_requested: boolean; duty_requested: boolean; capture_mode: string; active_session_id: string | null }[];
  const d = rows[0];
  const allowed = inHours && dev.active;
  return json({
    worker_name: dev.worker_name,
    active: dev.active,
    live_requested: !!d?.live_requested && allowed,
    duty: !!d?.duty_requested && allowed,
    session_id: d?.duty_requested ? d.active_session_id : null,
    capture_mode: d?.capture_mode === "video" ? "video" : "images",
    video_save_every_sec: s.video_save_every_sec,
    snapshot_interval_sec: s.snapshot_interval_sec,
    live_fps: s.live_fps,
    within_hours: inHours,
    work_start: s.work_start, work_end: s.work_end,
  });
});
