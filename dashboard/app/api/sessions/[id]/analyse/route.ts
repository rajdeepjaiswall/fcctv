import { sql } from "@/lib/db";
import { admin, json } from "@/lib/http";
import { analyseStep } from "@/lib/analysis";

export const dynamic = "force-dynamic";
export const maxDuration = 60;
type Ctx = { params: Promise<{ id: string }> };

/** One analysis step. Body {restart:true} wipes notes/summary and analyses the session again. */
export const POST = admin(async (req: Request, ctx: Ctx) => {
  const { id } = await ctx.params;
  const b = await req.json().catch(() => ({}));
  if (b.restart) {
    await sql`delete from session_notes where session_id = ${id}`;
    await sql`delete from session_messages where session_id = ${id} and role = 'assistant'
      and created_at = (select min(created_at) from session_messages where session_id = ${id})`;
    await sql`update sessions set summary = null, analysed_count = 0, ai_error = null, ai_lock_until = null,
      status = case when ended_at is null then 'recording' else 'analysing' end where id = ${id}`;
  }
  return json(await analyseStep(id));
});
