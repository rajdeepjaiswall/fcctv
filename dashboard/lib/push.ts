import webpush from "web-push";
import { sql, getSettings } from "./db";

/** VAPID keys are generated once and kept in the database (no env vars needed). */
export async function vapid(): Promise<{ publicKey: string; privateKey: string }> {
  const s = await getSettings();
  if (s.vapid_public && s.vapid_private) return { publicKey: s.vapid_public, privateKey: s.vapid_private };
  const keys = webpush.generateVAPIDKeys();
  await sql`update settings set vapid_public = ${keys.publicKey}, vapid_private = ${keys.privateKey}
    where id = 1 and vapid_public is null`;
  const again = await getSettings();
  return { publicKey: again.vapid_public!, privateKey: again.vapid_private! };
}

export type PushPayload = { title: string; body: string; url: string; image?: string | null; tag?: string };

/** Sends to every subscribed owner device; drops subscriptions the browser has revoked. */
export async function pushAll(p: PushPayload): Promise<number> {
  const { publicKey, privateKey } = await vapid();
  webpush.setVapidDetails("mailto:contact@getdownaf.info", publicKey, privateKey);
  const subs = (await sql`select id, endpoint, p256dh, auth from push_subscriptions`) as { id: string; endpoint: string; p256dh: string; auth: string }[];
  let sent = 0;
  await Promise.all(subs.map(async (s) => {
    try {
      await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, JSON.stringify(p), { TTL: 3600, urgency: "high" });
      sent++;
    } catch (e) {
      const code = (e as { statusCode?: number }).statusCode;
      if (code === 404 || code === 410) await sql`delete from push_subscriptions where id = ${s.id}`;
      else console.warn("push failed", code, (e as Error).message);
    }
  }));
  return sent;
}
