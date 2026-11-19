import { sql } from "@/lib/db";
import { admin, json } from "@/lib/http";

export const dynamic = "force-dynamic";
export const GET = admin(async () => {
  const r = (await sql`select count(*)::int as n,
      (select a.id from alerts a where not a.seen and not a.false_alarm order by a.created_at desc limit 1) as latest_id,
      (select w.name || ' ' || coalesce(r.alert_message, r.name) from alerts a join workers w on w.id = a.worker_id
         join alert_rules r on r.id = a.rule_id where not a.seen and not a.false_alarm order by a.created_at desc limit 1) as latest_text
    from alerts where not seen and not false_alarm`) as { n: number; latest_id: string | null; latest_text: string | null }[];
  return json(r[0]);
});
