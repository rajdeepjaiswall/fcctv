import { sql } from "@/lib/db";
import { admin, json } from "@/lib/http";

export const dynamic = "force-dynamic";
type Ctx = { params: Promise<{ id: string }> };

/** {false_alarm: bool} */
export const PATCH = admin(async (req: Request, ctx: Ctx) => {
  const { id } = await ctx.params;
  const b = await req.json().catch(() => ({}));
  if (typeof b.false_alarm === "boolean") await sql`update alerts set false_alarm = ${b.false_alarm}, seen = true where id = ${id}`;
  return json({ ok: true });
});
