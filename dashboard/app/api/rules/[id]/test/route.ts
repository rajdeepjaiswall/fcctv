import { admin, json } from "@/lib/http";
import { testRule } from "@/lib/rules";

export const dynamic = "force-dynamic";
export const maxDuration = 60;
type Ctx = { params: Promise<{ id: string }> };

export const POST = admin(async (_req: Request, ctx: Ctx) => {
  const { id } = await ctx.params;
  return json(await testRule(id));
});
