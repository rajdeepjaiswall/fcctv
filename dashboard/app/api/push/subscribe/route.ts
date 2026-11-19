import { sql } from "@/lib/db";
import { admin, json } from "@/lib/http";

export const dynamic = "force-dynamic";

export const POST = admin(async (req: Request) => {
  const b = await req.json().catch(() => ({}));
  const endpoint = String(b?.endpoint ?? "");
  const p256dh = String(b?.keys?.p256dh ?? "");
  const auth = String(b?.keys?.auth ?? "");
  if (!endpoint.startsWith("https://") || !p256dh || !auth) return json({ error: "Bad subscription" }, 400);
  await sql`insert into push_subscriptions (endpoint, p256dh, auth, label) values (${endpoint}, ${p256dh}, ${auth}, ${String(b.label ?? "").slice(0, 80)})
    on conflict (endpoint) do update set p256dh = excluded.p256dh, auth = excluded.auth`;
  return json({ ok: true });
});

export const DELETE = admin(async (req: Request) => {
  const b = await req.json().catch(() => ({}));
  await sql`delete from push_subscriptions where endpoint = ${String(b?.endpoint ?? "")}`;
  return json({ ok: true });
});
