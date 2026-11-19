import { sql } from "@/lib/db";
import { admin, json } from "@/lib/http";
import { pairCode } from "@/lib/auth";

export const dynamic = "force-dynamic";

/** Add a worker; returns a pairing code to type into their phone (valid 24 h). */
export const POST = admin(async (req: Request) => {
  const b = await req.json().catch(() => ({}));
  const name = String(b.name ?? "").trim().slice(0, 80);
  if (!name) return json({ error: "Enter the worker's name." }, 400);
  const w = (await sql`insert into workers (name, phone) values (${name}, ${b.phone ?? null}) returning id`) as { id: string }[];
  const code = pairCode();
  await sql`insert into devices (worker_id, pair_code, pair_expires_at) values (${w[0].id}, ${code}, now() + interval '24 hours')`;
  return json({ id: w[0].id, pair_code: code });
});
