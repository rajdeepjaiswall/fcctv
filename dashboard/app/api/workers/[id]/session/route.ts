import { after } from "next/server";
import { sql, getSettings } from "@/lib/db";
import { admin, json } from "@/lib/http";
import { endActiveSession } from "@/lib/sessions";
import { analyseFor } from "@/lib/analysis";

export const dynamic = "force-dynamic";
export const maxDuration = 60;
type Ctx = { params: Promise<{ id: string }> };

/** Owner starts/stops a capture session on a worker's phone. Body: {action:"start", mode:"images"|"video"} | {action:"stop"} */
export const POST = admin(async (req: Request, ctx: Ctx) => {
  const { id } = await ctx.params;
  const b = await req.json().catch(() => ({}));
  if (b.action === "start") {
    const devs = (await sql`select id, paired_at, active_session_id from devices where worker_id = ${id}`) as { id: string; paired_at: string | null; active_session_id: string | null }[];
    const dev = devs[0];
    if (!dev?.paired_at) return json({ error: "This worker's phone isn't paired yet." }, 400);
    if (dev.active_session_id) return json({ session_id: dev.active_session_id, already: true });
    const s = await getSettings();
    const mode = b.mode === "video" || b.mode === "images" ? b.mode : s.default_capture_mode;
    const rows = (await sql`insert into sessions (worker_id, device_id, mode, status, started_by)
      values (${id}, ${dev.id}, ${mode}, 'recording', 'owner') returning id`) as { id: string }[];
    await sql`update devices set duty_requested = true, capture_mode = ${mode}, active_session_id = ${rows[0].id} where id = ${dev.id}`;
    await sql`insert into events (worker_id, device_id, type, message, data) values (${id}, ${dev.id}, 'session_start',
      ${`Owner started a session (${mode === "video" ? "video" : "photos"})`}, ${JSON.stringify({ session_id: rows[0].id })}::jsonb)`;
    return json({ session_id: rows[0].id });
  }
  if (b.action === "stop") {
    const sid = await endActiveSession(id, "owner");
    if (sid) after(() => analyseFor(sid).then(() => undefined));
    return json({ ok: true, session_id: sid });
  }
  return json({ error: "bad action" }, 400);
});
