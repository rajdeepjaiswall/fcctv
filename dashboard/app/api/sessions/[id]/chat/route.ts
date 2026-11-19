import { admin, json } from "@/lib/http";
import { askSession } from "@/lib/analysis";

export const dynamic = "force-dynamic";
export const maxDuration = 60;
type Ctx = { params: Promise<{ id: string }> };

export const POST = admin(async (req: Request, ctx: Ctx) => {
  const { id } = await ctx.params;
  const b = await req.json().catch(() => ({}));
  const q = String(b.question ?? "").trim().slice(0, 1000);
  if (!q) return json({ error: "Type a question." }, 400);
  return json({ answer: await askSession(id, q) });
});
