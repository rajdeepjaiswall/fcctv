import { sql, getSettings } from "./db";

/** Ends a worker's active session (owner Stop, worker Stop, or deactivation) and queues analysis. */
export async function endActiveSession(workerId: string, by: string): Promise<string | null> {
  const devs = (await sql`update devices d set duty_requested = false, live_requested = false, active_session_id = null
    from devices old where d.id = old.id and d.worker_id = ${workerId}
    returning old.active_session_id as sid`) as { sid: string | null }[];
  const sid = devs.find((d) => d.sid)?.sid ?? null;
  if (!sid) return null;
  const s = await getSettings();
  const count = ((await sql`select count(*)::int as n from snapshots where session_id = ${sid}`) as { n: number }[])[0].n;
  const status = count === 0 ? "empty" : s.auto_analyse && s.gemini_api_key ? "analysing" : "done";
  await sql`update sessions set ended_at = coalesce(ended_at, now()), status = ${status},
    summary = case when ${count} = 0 then 'No photos were captured in this session.' else summary end
    where id = ${sid}`;
  await sql`insert into events (worker_id, type, message, data) values (${workerId}, 'session_stop',
    ${`Session stopped by ${by} (${count} photos)`}, ${JSON.stringify({ session_id: sid })}::jsonb)`;
  return status === "analysing" ? sid : null;
}
