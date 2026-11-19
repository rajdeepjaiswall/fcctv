import { ensureSchema, sql, dbConfigured } from "@/lib/db";
import { json } from "@/lib/http";
import { randomToken, sha256 } from "@/lib/auth";

export const dynamic = "force-dynamic";

/** Worker phone exchanges a one-time pairing code (from the dashboard) for its own device token. */
export async function POST(req: Request) {
  if (!dbConfigured()) return json({ error: "Server database not connected yet." }, 503);
  await ensureSchema();
  const b = await req.json().catch(() => ({}));
  const code = String(b.code ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (code.length < 6) return json({ error: "Enter the pairing code from the owner's dashboard." }, 400);
  const rows = (await sql`
    select d.id, d.worker_id, w.name from devices d join workers w on w.id = d.worker_id
    where d.pair_code = ${code} and (d.pair_expires_at is null or d.pair_expires_at > now())`) as { id: string; worker_id: string; name: string }[];
  const dev = rows[0];
  if (!dev) return json({ error: "That code is wrong or expired. Ask the owner for a new one." }, 404);
  const token = randomToken();
  await sql`
    update devices set token_hash = ${sha256(token)}, pair_code = null, pair_expires_at = null, paired_at = now(),
      consent_at = ${b.consent_at ?? null}, consent_name = ${b.consent_name ?? null}, app_version = ${b.app_version ?? null}
    where id = ${dev.id}`;
  await sql`insert into events (worker_id, device_id, type, message)
    values (${dev.worker_id}, ${dev.id}, 'paired', ${`Phone paired; streaming consent given by ${b.consent_name ?? "worker"}`})`;
  return json({ device_id: dev.id, worker_name: dev.name, token });
}
