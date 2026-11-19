import { sql } from "@/lib/db";
import { admin, json } from "@/lib/http";

export const dynamic = "force-dynamic";
export const POST = admin(async () => { await sql`update alerts set seen = true where not seen`; return json({ ok: true }); });
