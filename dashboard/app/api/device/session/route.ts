import { after } from "next/server";
import { sql } from "@/lib/db";
import { json, device } from "@/lib/http";
import { endActiveSession } from "@/lib/sessions";
import { analyseFor } from "@/lib/analysis";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Sessions are started by the owner. The phone only reports when the worker turns FCCTV off. */
export const POST = device(async (req, dev) => {
  const b = await req.json().catch(() => ({}));
  if (b.action === "worker_off") {
    const sid = await endActiveSession(dev.worker_id, "worker");
    await sql`update devices set mode = 'off' where id = ${dev.id}`;
    await sql`insert into events (worker_id, device_id, type, message) values (${dev.worker_id}, ${dev.id}, 'worker_off', 'Worker switched FCCTV off')`;
    if (sid) after(() => analyseFor(sid).then(() => undefined));
    return json({ ok: true });
  }
  return json({ error: "bad action" }, 400);
});
