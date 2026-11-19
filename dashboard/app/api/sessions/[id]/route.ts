import { sql } from "@/lib/db";
import { admin, json } from "@/lib/http";
import { signedUrl, deleteObject } from "@/lib/r2";

export const dynamic = "force-dynamic";
type Ctx = { params: Promise<{ id: string }> };

export const GET = admin(async (_req: Request, ctx: Ctx) => {
  const { id } = await ctx.params;
  const rows = await sql`select s.*, w.name as worker_name from sessions s join workers w on w.id = s.worker_id where s.id = ${id}`;
  const session = rows[0];
  if (!session) return json({ error: "Session not found" }, 404);
  const snaps = (await sql`select id, key, taken_at, source from snapshots where session_id = ${id} order by taken_at`) as { id: string; key: string; taken_at: string; source: string }[];
  const urls = new Map<string, string | null>();
  await Promise.all(snaps.map(async (s) => urls.set(s.id, await signedUrl(s.key, 3600))));
  const notes = (await sql`select id, idx, from_at, to_at, text, snapshot_ids from session_notes where session_id = ${id} order by idx`) as { snapshot_ids: string[] }[];
  const messages = await sql`select id, role, content, created_at from session_messages where session_id = ${id} order by created_at`;
  return json({
    session,
    snapshots: snaps.map((s) => ({ id: s.id, taken_at: s.taken_at, source: s.source, url: urls.get(s.id) })),
    notes: notes.map((n) => ({ ...n, thumbs: n.snapshot_ids.slice(0, 10).map((sid) => urls.get(sid)).filter(Boolean) })),
    messages,
  });
});

/** Delete a session and its photos. */
export const DELETE = admin(async (_req: Request, ctx: Ctx) => {
  const { id } = await ctx.params;
  const keys = (await sql`select key from snapshots where session_id = ${id}`) as { key: string }[];
  await Promise.all(keys.map((k) => deleteObject(k.key)));
  await sql`delete from snapshots where session_id = ${id}`;
  await sql`delete from sessions where id = ${id} and ended_at is not null`;
  return json({ ok: true });
});
