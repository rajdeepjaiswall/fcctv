import { ensureSchema, sql, dbConfigured } from "@/lib/db";
import { currentAdmin } from "@/lib/auth";
import { json } from "@/lib/http";
import { r2Configured } from "@/lib/r2";

export const dynamic = "force-dynamic";

/** Tells the login page whether setup is needed and what's still missing on the server. */
export async function GET() {
  if (!dbConfigured()) return json({ db: false, r2: false, needsSetup: false, loggedIn: false });
  await ensureSchema();
  const rows = (await sql`select count(*)::int as n from admins`) as { n: number }[];
  return json({ db: true, r2: await r2Configured(), needsSetup: rows[0].n === 0, loggedIn: !!(await currentAdmin()) });
}
