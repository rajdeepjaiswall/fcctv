import { ensureSchema, sql, dbConfigured } from "@/lib/db";
import { startSession, verifyPassword } from "@/lib/auth";
import { json } from "@/lib/http";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  if (!dbConfigured()) return json({ error: "Database not connected yet." }, 503);
  await ensureSchema();
  const b = await req.json().catch(() => ({}));
  const email = String(b.email ?? "").trim().toLowerCase();
  const rows = (await sql`select id, pass_hash from admins where email = ${email}`) as { id: number; pass_hash: string }[];
  const ok = rows[0] && (await verifyPassword(String(b.password ?? ""), rows[0].pass_hash));
  if (!ok) {
    await new Promise((r) => setTimeout(r, 800)); // slow down guessing
    return json({ error: "Wrong email or password." }, 401);
  }
  await startSession(rows[0].id, email);
  return json({ ok: true });
}
