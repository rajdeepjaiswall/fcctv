import { AwsClient } from "aws4fetch";
import { getSettings } from "./db";

/**
 * Cloudflare R2 (S3-compatible), private bucket; the dashboard gets short-lived signed links.
 * Credentials come from env vars (R2_*) if set, otherwise from the owner's Settings page (stored in Neon).
 */
type R2 = { client: AwsClient; base: string };
let cached: { r2: R2 | null; at: number } | null = null;

export function clearR2Cache() { cached = null; }

export async function r2(): Promise<R2 | null> {
  if (cached && Date.now() - cached.at < 60_000) return cached.r2;
  let accountId = process.env.R2_ACCOUNT_ID, key = process.env.R2_ACCESS_KEY_ID, secretKey = process.env.R2_SECRET_ACCESS_KEY;
  let bucket = process.env.R2_BUCKET;
  if (!accountId || !key || !secretKey) {
    const s = await getSettings();
    accountId = s.r2_account_id ?? undefined; key = s.r2_access_key ?? undefined; secretKey = s.r2_secret_key ?? undefined;
    bucket = bucket || s.r2_bucket || undefined;
  }
  const value = accountId && key && secretKey ? {
    client: new AwsClient({ accessKeyId: key, secretAccessKey: secretKey, service: "s3", region: "auto" }),
    base: `https://${accountId}.r2.cloudflarestorage.com/${bucket || "fcctv-frames"}`,
  } : null;
  cached = { r2: value, at: Date.now() };
  return value;
}

export async function r2Configured() { return !!(await r2()); }

const objectUrl = (base: string, key: string) => `${base}/${key.split("/").map(encodeURIComponent).join("/")}`;

async function need(): Promise<R2> {
  const c = await r2();
  if (!c) throw new Error("Photo storage (Cloudflare R2) isn't set up yet — add it in Settings.");
  return c;
}

export async function putJpeg(key: string, body: Uint8Array) {
  const c = await need();
  const res = await c.client.fetch(objectUrl(c.base, key), {
    method: "PUT",
    body: body as unknown as BodyInit,
    headers: { "Content-Type": "image/jpeg", "Cache-Control": "no-store" },
  });
  if (!res.ok) throw new Error(`Photo storage error ${res.status}: ${(await res.text()).slice(0, 200)}`);
}

export async function deleteObject(key: string) {
  const c = await r2();
  if (c) await c.client.fetch(objectUrl(c.base, key), { method: "DELETE" }).catch(() => undefined);
}

/** A link the owner's browser can open for [seconds]. */
export async function signedUrl(key: string, seconds = 600): Promise<string | null> {
  const c = await r2();
  if (!c) return null;
  const url = new URL(objectUrl(c.base, key));
  url.searchParams.set("X-Amz-Expires", String(seconds));
  const signed = await c.client.sign(new Request(url, { method: "GET" }), { aws: { signQuery: true } });
  return signed.url;
}

/** Writes, reads and deletes a tiny test file. Returns an error message or null. */
export async function testR2(): Promise<string | null> {
  try {
    const c = await need();
    const key = `test/check-${Date.now()}.txt`;
    const put = await c.client.fetch(objectUrl(c.base, key), { method: "PUT", body: "ok", headers: { "Content-Type": "text/plain" } });
    if (!put.ok) return `Upload failed (${put.status}): ${(await put.text()).slice(0, 160)}`;
    const get = await c.client.fetch(objectUrl(c.base, key));
    if (!get.ok) return `Read failed (${get.status})`;
    await c.client.fetch(objectUrl(c.base, key), { method: "DELETE" });
    return null;
  } catch (e) { return (e as Error).message; }
}
