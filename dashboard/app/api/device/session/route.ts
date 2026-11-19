import { sql } from "@/lib/db";
import { json, device } from "@/lib/http";

export const dynamic = "force-dynamic";

export const POST = device(async (req, dev) => {
  const b = await req.json().catch(() => ({}));
  if (b.action === "start") {
    const rows = (await sql`insert into sessions (worker_id, device_id) values (${dev.worker_id}, ${dev.id}) returning id`) as { id: string }[];
    await sql`insert into events (worker_id, device_id, type, message) values (${dev.worker_id}, ${dev.id}, 'duty_start', 'Started duty')`;
    return json({ session_id: rows[0].id });
  }
  if (b.action === "stop" && typeof b.session_id === "string") {
    await sql`update sessions set ended_at = now() where id = ${b.session_id} and device_id = ${dev.id}`;
    await sql`update devices set mode = 'off', live_requested = false where id = ${dev.id}`;
    await sql`insert into events (worker_id, device_id, type, message) values (${dev.worker_id}, ${dev.id}, 'duty_stop', 'Stopped duty')`;
    return json({ ok: true });
  }
  return json({ error: "bad action" }, 400);
});
