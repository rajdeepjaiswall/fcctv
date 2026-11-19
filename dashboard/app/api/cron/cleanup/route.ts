import { ensureSchema, sql, getSettings, dbConfigured } from "@/lib/db";
import { json } from "@/lib/http";
import { deleteObject } from "@/lib/r2";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Daily (Vercel Cron): deletes snapshots older than the retention period. */
export async function GET(req: Request) {
  if (process.env.CRON_SECRET && req.headers.get("authorization") !== `Bearer ${process.env.CRON_SECRET}`) {
    return json({ error: "forbidden" }, 403);
  }
  if (!dbConfigured()) return json({ skipped: "no db" });
  await ensureSchema();
  const { retention_days } = await getSettings();
  let deleted = 0;
  for (let round = 0; round < 20; round++) {
    const old = (await sql`select id, key from snapshots where taken_at < now() - make_interval(days => ${retention_days})
      order by taken_at limit 200`) as { id: string; key: string }[];
    if (!old.length) break;
    await Promise.all(old.map((s) => deleteObject(s.key)));
    await sql`delete from snapshots where id = any(${old.map((s) => s.id)}::uuid[])`;
    deleted += old.length;
  }
  await sql`delete from events where created_at < now() - make_interval(days => ${Math.max(retention_days, 90)})`;
  return json({ deleted });
}
