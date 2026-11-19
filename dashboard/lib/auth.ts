import { SignJWT, jwtVerify } from "jose";
import { cookies } from "next/headers";
import { randomBytes, scrypt as _scrypt, timingSafeEqual, createHash } from "node:crypto";
import { promisify } from "node:util";
import { dbUrl } from "./db";

const scrypt = promisify(_scrypt) as (pw: string, salt: Buffer, len: number) => Promise<Buffer>;
export const SESSION_COOKIE = "fcctv_session";

/** SESSION_SECRET if set; otherwise derived from the (secret) Neon connection string. */
function secret() {
  const explicit = process.env.SESSION_SECRET;
  if (explicit && explicit.length >= 32) return new TextEncoder().encode(explicit);
  const db = dbUrl;
  if (!db) throw new Error("Server not configured (no database)");
  return new TextEncoder().encode(createHash("sha256").update("fcctv-session-v1:" + db).digest("hex"));
}

export async function hashPassword(pw: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await scrypt(pw, salt, 64);
  return `scrypt$${salt.toString("hex")}$${key.toString("hex")}`;
}

export async function verifyPassword(pw: string, stored: string): Promise<boolean> {
  const [, saltHex, keyHex] = stored.split("$");
  if (!saltHex || !keyHex) return false;
  const key = await scrypt(pw, Buffer.from(saltHex, "hex"), 64);
  return timingSafeEqual(key, Buffer.from(keyHex, "hex"));
}

export async function startSession(adminId: number, email: string) {
  const jwt = await new SignJWT({ email }).setProtectedHeader({ alg: "HS256" })
    .setSubject(String(adminId)).setIssuedAt().setExpirationTime("30d").sign(secret());
  (await cookies()).set(SESSION_COOKIE, jwt, {
    httpOnly: true, secure: true, sameSite: "lax", path: "/", maxAge: 60 * 60 * 24 * 30,
  });
}

export async function endSession() { (await cookies()).delete(SESSION_COOKIE); }

/** Returns the signed-in owner, or null. */
export async function currentAdmin(): Promise<{ id: number; email: string } | null> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, secret());
    return { id: Number(payload.sub), email: String(payload.email) };
  } catch { return null; }
}

export const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");
export const randomToken = () => randomBytes(32).toString("hex");

/** 8 characters, no look-alikes (0/O, 1/I), easy to type on a phone. */
export function pairCode() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const b = randomBytes(8);
  return Array.from(b, (x) => alphabet[x % alphabet.length]).join("");
}
