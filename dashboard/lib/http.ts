import { NextResponse } from "next/server";
import { currentAdmin } from "./auth";
import { ensureSchema, sql, dbConfigured } from "./db";
import { sha256 } from "./auth";

export const json = (body: unknown, status = 200) => NextResponse.json(body, { status });

/** Wraps an owner-only API handler: checks DB, schema and login. */
export function admin<A extends unknown[]>(fn: (...args: A) => Promise<Response>) {
  return async (...args: A) => {
    if (!dbConfigured()) return json({ error: "Database not connected yet (add Neon in Vercel → Storage)." }, 503);
    try {
      await ensureSchema();
      if (!(await currentAdmin())) return json({ error: "Please log in." }, 401);
      return await fn(...args);
    } catch (e) {
      console.error(e);
      return json({ error: (e as Error).message }, 500);
    }
  };
}

export type DeviceAuth = { id: string; worker_id: string; worker_name: string; active: boolean };

/** Finds the paired phone from its Bearer token. */
export async function deviceFromRequest(req: Request): Promise<DeviceAuth | null> {
  const token = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
  if (token.length < 32) return null;
  const rows = (await sql`
    select d.id, d.worker_id, w.name as worker_name, w.active
    from devices d join workers w on w.id = d.worker_id
    where d.token_hash = ${sha256(token)}`) as DeviceAuth[];
  return rows[0] ?? null;
}

/** Wraps a worker-phone API handler. */
export function device(fn: (req: Request, dev: DeviceAuth) => Promise<Response>) {
  return async (req: Request) => {
    if (!dbConfigured()) return json({ error: "Server database not connected yet." }, 503);
    try {
      await ensureSchema();
      const dev = await deviceFromRequest(req);
      if (!dev) return json({ error: "unpaired" }, 401);
      return await fn(req, dev);
    } catch (e) {
      console.error(e);
      return json({ error: (e as Error).message }, 500);
    }
  };
}
