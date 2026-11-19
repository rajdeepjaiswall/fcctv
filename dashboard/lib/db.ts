import { neon } from "@neondatabase/serverless";

/** Neon connection string, set by Vercel's Neon integration (DATABASE_URL) or manually. */
function findDbUrl(): string | undefined {
  const env = process.env;
  const preferred = ["DATABASE_URL", "POSTGRES_URL", "NEON_DATABASE_URL"];
  for (const k of preferred) if (env[k]?.startsWith("postgres")) return env[k];
  // Vercel's Neon integration can add a custom prefix (e.g. STORAGE_DATABASE_URL, FCCTV_POSTGRES_URL).
  const keys = Object.keys(env).filter((k) => /(DATABASE_URL|POSTGRES_URL)$/.test(k) && !/UNPOOLED|NON_POOLING/.test(k));
  for (const k of keys) if (env[k]?.startsWith("postgres")) return env[k];
  for (const k of Object.keys(env)) if (/_URL$/.test(k) && env[k]?.startsWith("postgres")) return env[k];
  return undefined;
}

export const dbUrl = findDbUrl();
const url = dbUrl;

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
  // ---- Phase 3.5: remote sessions + AI
  `alter table devices add column if not exists duty_requested boolean not null default false`,
  `alter table devices add column if not exists capture_mode text not null default 'images'`,
  `alter table devices add column if not exists active_session_id uuid`,
  `alter table sessions add column if not exists mode text not null default 'images'`,
  `alter table sessions add column if not exists status text not null default 'recording'`,
  `alter table sessions add column if not exists summary text`,
  `alter table sessions add column if not exists analysed_count int not null default 0`,
  `alter table sessions add column if not exists ai_error text`,
  `alter table sessions add column if not exists started_by text`,
  `alter table sessions add column if not exists title text`,
  `create table if not exists session_notes (
     id uuid primary key default gen_random_uuid(),
     session_id uuid not null references sessions on delete cascade,
     idx int not null, from_at timestamptz, to_at timestamptz, text text not null,
     snapshot_ids uuid[] not null default '{}', created_at timestamptz not null default now(),
     unique (session_id, idx))`,
  `create table if not exists session_messages (
     id uuid primary key default gen_random_uuid(),
     session_id uuid not null references sessions on delete cascade,
     role text not null, content text not null, created_at timestamptz not null default now())`,
  `create index if not exists session_messages_s on session_messages (session_id, created_at)`,
  `create index if not exists snapshots_session on snapshots (session_id, taken_at)`,
  `alter table sessions add column if not exists ai_lock_until timestamptz`,
  `alter table settings add column if not exists gemini_api_key text`,
  `alter table settings add column if not exists ai_model text not null default 'gemini-3.6-flash'`,
  `alter table settings add column if not exists ai_language text not null default 'en'`,
  `alter table settings add column if not exists summary_batch int not null default 10`,
  `alter table settings add column if not exists auto_analyse boolean not null default true`,
  `alter table settings add column if not exists default_capture_mode text not null default 'images'`,
  `alter table settings add column if not exists video_save_every_sec int not null default 3`,
  // ---- Alerts: plain-language rules checked by AI on every frame
  `alter table settings add column if not exists ai_models text`,
  `alter table settings add column if not exists detection_enabled boolean not null default true`,
  `alter table settings add column if not exists check_every_sec int not null default 10`,
  `alter table settings add column if not exists vapid_public text`,
  `alter table settings add column if not exists vapid_private text`,
  `create table if not exists alert_rules (
     id uuid primary key default gen_random_uuid(),
     text text not null, name text, look_for text, alert_message text, ai_note text,
     understood boolean not null default false, alert_enabled boolean not null default false,
     min_duration_sec int not null default 0, min_confidence real not null default 0.6, cooldown_sec int not null default 300,
     worker_ids uuid[], created_at timestamptz not null default now())`,
  `create table if not exists alerts (
     id uuid primary key default gen_random_uuid(),
     rule_id uuid references alert_rules on delete cascade,
     worker_id uuid references workers on delete cascade,
     session_id uuid references sessions on delete set null,
     snapshot_id uuid references snapshots on delete set null,
     confidence real, reason text, notified boolean not null default false,
     seen boolean not null default false, false_alarm boolean not null default false,
     created_at timestamptz not null default now())`,
  `create index if not exists alerts_time on alerts (created_at desc)`,
  `create index if not exists alerts_rule_worker on alerts (rule_id, worker_id, created_at desc)`,
  `create table if not exists rule_state (
     rule_id uuid not null references alert_rules on delete cascade,
     worker_id uuid not null references workers on delete cascade,
     first_seen timestamptz not null, last_seen timestamptz not null,
     primary key (rule_id, worker_id))`,
  `create table if not exists push_subscriptions (
     id uuid primary key default gen_random_uuid(), endpoint text unique not null,
     p256dh text not null, auth text not null, label text, created_at timestamptz not null default now())`,
  `alter table devices add column if not exists last_check_at timestamptz`,
  `alter table devices add column if not exists battery_at timestamptz`,
  `alter table devices add column if not exists phone_battery_at timestamptz`,
  `alter table devices add column if not exists glasses_connected boolean`,
  `alter table sessions add column if not exists summary_at timestamptz`,
  `alter table sessions add column if not exists summary_frames int`,
  `alter table session_messages add column if not exists pending boolean not null default false`,
  `insert into alert_rules (text, name, look_for, alert_message, understood, alert_enabled, min_confidence, cooldown_sec)
     select 'Using a mobile phone', 'Phone use',
       'The wearer is holding a mobile phone in their hand(s) and looking at, typing on, or talking on it. A phone lying on a counter, a shop billing tablet or a customer''s phone does not count.',
       'is using their phone', true, true, 0.65, 180
     where not exists (select 1 from alert_rules)`,
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
  gemini_api_key: string | null; ai_model: string; ai_language: "en" | "hi"; summary_batch: number; auto_analyse: boolean;
  default_capture_mode: "images" | "video"; video_save_every_sec: number;
  ai_models: string | null; detection_enabled: boolean; check_every_sec: number;
  vapid_public: string | null; vapid_private: string | null;
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
