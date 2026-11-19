import { sql } from "@/lib/db";
import { admin, json } from "@/lib/http";
import { interpretRule } from "@/lib/rules";
import { AiBusyError } from "@/lib/ai";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export const GET = admin(async () => {
  const rules = await sql`select r.*,
      (select count(*)::int from alerts a where a.rule_id = r.id and not a.false_alarm
        and (a.created_at at time zone 'Asia/Kolkata')::date = (now() at time zone 'Asia/Kolkata')::date) as today
    from alert_rules r order by r.created_at`;
  const workers = await sql`select id, name from workers where active order by name`;
  return json({ rules, workers });
});

/** Owner types an action; the AI understands it (✓). Alerts stay off until the owner taps "Alert me". */
export const POST = admin(async (req: Request) => {
  const b = await req.json().catch(() => ({}));
  const text = String(b.text ?? "").trim().slice(0, 300);
  if (!text) return json({ error: "Type what you want to be alerted about." }, 400);
  const row = (await sql`insert into alert_rules (text) values (${text}) returning id`) as { id: string }[];
  try {
    const r = await interpretRule(text);
    await sql`update alert_rules set name = ${r.name}, look_for = ${r.look_for}, min_duration_sec = ${r.min_duration_sec},
      alert_message = ${r.alert_message}, ai_note = ${r.ai_note}, understood = ${r.understood} where id = ${row[0].id}`;
  } catch (e) {
    const note = e instanceof AiBusyError ? "AI is busy; tap “Retry” in a moment." : (e as Error).message;
    await sql`update alert_rules set ai_note = ${note} where id = ${row[0].id}`;
  }
  return json({ id: row[0].id });
});
