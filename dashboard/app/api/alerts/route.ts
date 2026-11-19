import { sql } from "@/lib/db";
import { admin, json } from "@/lib/http";
import { signedUrl } from "@/lib/r2";

export const dynamic = "force-dynamic";

/** ?day=YYYY-MM-DD (IST, default today) &worker= &rule= */
export const GET = admin(async (req: Request) => {
  const u = new URL(req.url);
  const day = /^\d{4}-\d{2}-\d{2}$/.test(u.searchParams.get("day") ?? "") ? u.searchParams.get("day")! : null;
  const worker = u.searchParams.get("worker") || null;
  const rule = u.searchParams.get("rule") || null;
  const rows = (await sql`
    select a.id, a.created_at, a.confidence, a.reason, a.seen, a.false_alarm, a.notified, a.session_id,
           r.id as rule_id, r.name as rule_name, r.alert_message, w.id as worker_id, w.name as worker_name, s.key
    from alerts a
    join alert_rules r on r.id = a.rule_id
    join workers w on w.id = a.worker_id
    left join snapshots s on s.id = a.snapshot_id
    where (a.created_at at time zone 'Asia/Kolkata')::date = coalesce(${day}::date, (now() at time zone 'Asia/Kolkata')::date)
      and (${worker}::uuid is null or a.worker_id = ${worker}::uuid)
      and (${rule}::uuid is null or a.rule_id = ${rule}::uuid)
    order by a.created_at desc limit 300`) as (Record<string, unknown> & { key: string | null })[];
  const counts = await sql`
    select r.name as rule_name, w.name as worker_name, count(*)::int as n
    from alerts a join alert_rules r on r.id = a.rule_id join workers w on w.id = a.worker_id
    where not a.false_alarm
      and (a.created_at at time zone 'Asia/Kolkata')::date = coalesce(${day}::date, (now() at time zone 'Asia/Kolkata')::date)
    group by r.name, w.name order by n desc`;
  const unseen = ((await sql`select count(*)::int as n from alerts where not seen`) as { n: number }[])[0].n;
  return json({
    alerts: await Promise.all(rows.map(async ({ key, ...a }) => ({ ...a, image: key ? await signedUrl(key, 3600) : null }))),
    counts, unseen,
  });
});
