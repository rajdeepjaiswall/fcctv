import { after } from "next/server";
import { sql, getSettings, withinHours } from "@/lib/db";
import { backgroundTick } from "@/lib/analysis";
import { json, device } from "@/lib/http";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Phone reports status every few seconds; we answer with what it should be doing. */
export const POST = device(async (req, dev) => {
  const b = await req.json().catch(() => ({}));
  const s = await getSettings();
  const inHours = withinHours(s);
  const mode = ["off", "standby", "snapshot", "live", "paused"].includes(b.mode) ? b.mode : "off";
  const rows = (await sql`
    update devices set last_seen = now(), mode = ${mode},
      battery = coalesce(${b.battery ?? null}::int, battery), charging = coalesce(${b.charging ?? null}::boolean, charging),
      battery_at = case when ${b.battery ?? null}::int is not null then now() else battery_at end,
      phone_battery = coalesce(${b.phone_battery ?? null}::int, phone_battery),
      phone_battery_at = case when ${b.phone_battery ?? null}::int is not null then now() else phone_battery_at end,
      glasses_connected = ${typeof b.glasses_connected === "boolean" ? b.glasses_connected : null},
      status_detail = ${typeof b.detail === "string" ? b.detail.slice(0, 200) : null},
      glasses_name = ${b.glasses_name ?? null}, glasses_mac = ${b.glasses_mac ?? null}, app_version = ${b.app_version ?? null}
    where id = ${dev.id} returning live_requested, duty_requested, capture_mode, active_session_id`) as {
      live_requested: boolean; duty_requested: boolean; capture_mode: string; active_session_id: string | null }[];
  const d = rows[0];
  const allowed = inHours && dev.active;
  // Phones heartbeat every few seconds; use that to finish queued AI work in the background.
  after(() => backgroundTick().catch(() => undefined));
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
