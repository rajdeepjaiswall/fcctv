import { sql } from "@/lib/db";
import { admin, json } from "@/lib/http";
import { interpretRule } from "@/lib/rules";
import { AiBusyError } from "@/lib/ai";

export const dynamic = "force-dynamic";
export const maxDuration = 60;
type Ctx = { params: Promise<{ id: string }> };

/** {alert_enabled} | {min_confidence} | {cooldown_sec} | {min_duration_sec} | {worker_ids} | {text} (re-understand) | {retry:true} */
export const PATCH = admin(async (req: Request, ctx: Ctx) => {
  const { id } = await ctx.params;
  const b = await req.json().catch(() => ({}));
  if (typeof b.alert_enabled === "boolean") await sql`update alert_rules set alert_enabled = ${b.alert_enabled} where id = ${id}`;
  if (Number.isFinite(Number(b.min_confidence))) await sql`update alert_rules set min_confidence = ${Math.min(0.95, Math.max(0.3, Number(b.min_confidence)))} where id = ${id}`;
  if (Number.isFinite(Number(b.cooldown_sec))) await sql`update alert_rules set cooldown_sec = ${Math.min(86400, Math.max(30, Math.round(Number(b.cooldown_sec))))} where id = ${id}`;
  if (Number.isFinite(Number(b.min_duration_sec))) await sql`update alert_rules set min_duration_sec = ${Math.min(3600, Math.max(0, Math.round(Number(b.min_duration_sec))))} where id = ${id}`;
  if (Array.isArray(b.worker_ids)) await sql`update alert_rules set worker_ids = ${b.worker_ids.length ? b.worker_ids : null}::uuid[] where id = ${id}`;
  if (typeof b.text === "string" && b.text.trim()) await sql`update alert_rules set text = ${b.text.trim().slice(0, 300)}, understood = false where id = ${id}`;
  if (b.retry || typeof b.text === "string") {
    const row = (await sql`select text from alert_rules where id = ${id}`) as { text: string }[];
    try {
      const r = await interpretRule(row[0].text);
      await sql`update alert_rules set name = ${r.name}, look_for = ${r.look_for}, min_duration_sec = ${r.min_duration_sec},
        alert_message = ${r.alert_message}, ai_note = ${r.ai_note}, understood = ${r.understood} where id = ${id}`;
    } catch (e) {
      await sql`update alert_rules set ai_note = ${e instanceof AiBusyError ? "AI is busy; tap “Retry” in a moment." : (e as Error).message} where id = ${id}`;
    }
  }
  return json({ ok: true });
});

export const DELETE = admin(async (_req: Request, ctx: Ctx) => {
  const { id } = await ctx.params;
  await sql`delete from alert_rules where id = ${id}`;
  return json({ ok: true });
});
