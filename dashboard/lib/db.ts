import { neon } from "@neondatabase/serverless";

/** Neon connection string, set by Vercel's Neon integration (DATABASE_URL) or manually. */
const url = process.env.DATABASE_URL ?? process.env.POSTGRES_URL ?? process.env.NEON_DATABASE_URL;

export const sql = neon(url ?? "postgres://missing:missing@localhost/missing");

export function dbConfigured() { return !!url; }

const SCHEMA = [
  `create table if not exists admins (
     id serial primary key, email text unique not null, pass_hash text not null, created_at timestamptz not null default now())`,
  `create table if not exists settings (
     id int primary key default 1 check (id = 1),
     snapshot_interval_sec int not null default 10,
     live_fps int not null default 2,
     retention_days int not null default 30,
     enforce_hours boolean not null default false,
     work_start text not null default '09:00',
     work_end text not null default '21:00',
     timezone text not null default 'Asia/Kolkata',
     updated_at timestamptz not null default now())`,
  `insert into settings (id) values (1) on conflict do nothing`,
  `alter table settings add column if not exists r2_account_id text`,
  `alter table settings add column if not exists r2_access_key text`,
  `alter table settings add column if not exists r2_secret_key text`,
  `alter table settings add column if not exists r2_bucket text`,
  `create table if not exists workers (
     id uuid primary key default gen_random_uuid(), name text not null, phone text,
     active boolean not null default true, created_at timestamptz not null default now())`,
  `create table if not exists devices (
     id uuid primary key default gen_random_uuid(),
     worker_id uuid not null references workers on delete cascade,
     pair_code text unique, pair_expires_at timestamptz, token_hash text unique, paired_at timestamptz,
     consent_at timestamptz, consent_name text, glasses_name text, glasses_mac text, app_version text,
     battery int, charging boolean, phone_battery int,
     mode text not null default 'off', live_requested boolean not null default false, status_detail text,
     last_seen timestamptz, last_frame_at timestamptz, latest_frame_key text,
     created_at timestamptz not null default now())`,
  `create index if not exists devices_worker on devices (worker_id)`,
  `create table if not exists sessions (
     id uuid primary key default gen_random_uuid(),
     worker_id uuid not null references workers on delete cascade,
     device_id uuid not null references devices on delete cascade,
     started_at timestamptz not null default now(), ended_at timestamptz,
     snapshots int not null default 0)`,
  `create index if not exists sessions_worker on sessions (worker_id, started_at desc)`,
  `create table if not exists snapshots (
     id uuid primary key default gen_random_uuid(),
     worker_id uuid not null references workers on delete cascade,
     device_id uuid not null references devices on delete cascade,
     session_id uuid references sessions on delete set null,
     key text not null, source text not null default 'photo', battery int, bytes int,
     taken_at timestamptz not null default now())`,
  `create index if not exists snapshots_worker on snapshots (worker_id, taken_at desc)`,
  `create table if not exists events (
     id uuid primary key default gen_random_uuid(),
     worker_id uuid references workers on delete cascade,
     device_id uuid references devices on delete cascade,
     type text not null, message text, data jsonb,
     snapshot_id uuid references snapshots on delete set null,
     false_alarm boolean not null default false,
     created_at timestamptz not null default now())`,
  `create index if not exists events_time on events (created_at desc)`,
];

let ready: Promise<void> | null = null;

/** Creates the tables on first use (idempotent), so no manual migration step is needed. */
export function ensureSchema(): Promise<void> {
  if (!ready) {
    ready = (async () => {
      for (const stmt of SCHEMA) await sql.query(stmt);
    })().catch((e) => { ready = null; throw e; });
  }
  return ready;
}

export type Settings = {
  snapshot_interval_sec: number; live_fps: number; retention_days: number;
  enforce_hours: boolean; work_start: string; work_end: string; timezone: string;
  r2_account_id: string | null; r2_access_key: string | null; r2_secret_key: string | null; r2_bucket: string | null;
};

export async function getSettings(): Promise<Settings> {
  const rows = (await sql`select * from settings where id = 1`) as Settings[];
  return rows[0];
}

export function withinHours(s: Settings, at = new Date()): boolean {
  if (!s.enforce_hours) return true;
  const now = new Intl.DateTimeFormat("en-GB", { timeZone: s.timezone, hour: "2-digit", minute: "2-digit", hour12: false }).format(at).slice(0, 5);
  const start = s.work_start.slice(0, 5), end = s.work_end.slice(0, 5);
  return start <= end ? now >= start && now < end : now >= start || now < end;
}
