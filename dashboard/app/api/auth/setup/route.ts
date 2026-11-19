import { ensureSchema, sql, dbConfigured } from "@/lib/db";
import { hashPassword, startSession } from "@/lib/auth";
import { json } from "@/lib/http";

export const dynamic = "force-dynamic";

/** One-time: creates the owner account. Refused once an owner exists. */
export async function POST(req: Request) {
  if (!dbConfigured()) return json({ error: "Database not connected yet." }, 503);
  await ensureSchema();
  const b = await req.json().catch(() => ({}));
  const email = String(b.email ?? "").trim().toLowerCase();
  const password = String(b.password ?? "");
  if (!/^\S+@\S+\.\S+$/.test(email)) return json({ error: "Enter a valid email." }, 400);
  if (password.length < 8) return json({ error: "Password must be at least 8 characters." }, 400);
  const hash = await hashPassword(password);
  const rows = (await sql`
    insert into admins (email, pass_hash) select ${email}, ${hash}
    where not exists (select 1 from admins) returning id`) as { id: number }[];
  if (!rows[0]) return json({ error: "Owner account already exists. Please log in." }, 409);
  await startSession(rows[0].id, email);
  return json({ ok: true });
}
