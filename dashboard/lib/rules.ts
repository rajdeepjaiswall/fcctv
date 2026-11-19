/**
 * Alert rules written by the owner in plain words ("using phone", "smoking", "sitting idle for 5 minutes").
 * 1. interpretRule(): the AI turns the words into a precise visual check (the ✓ in Settings).
 * 2. checkFrame(): on new frames, the AI checks all enabled rules at once and answers in JSON.
 * 3. Matches become alerts (respecting confidence, "for N minutes" duration and cooldown) and push notifications.
 */
import { sql, getSettings } from "./db";
import { getObject, signedUrl } from "./r2";
import { getVisionModel, languageName, type AiPart } from "./ai";
import { pushAll } from "./push";

export type Rule = {
  id: string; text: string; name: string | null; look_for: string | null; alert_message: string | null; ai_note: string | null;
  understood: boolean; alert_enabled: boolean; min_duration_sec: number; min_confidence: number; cooldown_sec: number;
  worker_ids: string[] | null;
};

function parseJson<T>(text: string): T {
  const m = text.match(/\{[\s\S]*\}/);
  return JSON.parse(m ? m[0] : text) as T;
}

/** AI reads the owner's words and returns a precise rule. */
export async function interpretRule(text: string) {
  const s = await getSettings();
  const model = await getVisionModel(40_000);
  const out = await model.generate({
    system: "You turn a shop owner's plain-language request (English, Hindi or Hinglish) into a rule that a vision AI can check " +
      "on photos from a camera on the worker's glasses (first-person view: you see the worker's hands and what they look at).",
    turns: [{ role: "user", parts: [{ text:
      `Owner wrote: "${text}"\n\nReply with JSON only:\n` +
      `{"understood": true|false, "name": "2-4 word title in English", ` +
      `"look_for": "1-3 sentences describing exactly what must be visible in a first-person photo for this to be true, and what does NOT count", ` +
      `"min_duration_sec": number (seconds it must continue before alerting; 0 if not mentioned; e.g. 'for 5 minutes' = 300), ` +
      `"alert_message": "short phrase completing '<worker name> …', e.g. 'is using their phone'", ` +
      `"note": "one short sentence for the owner in ${languageName(s.ai_language)}: what you will watch for, or a question if it can't be seen by a camera"}\n` +
      `Set understood=false only if this cannot be judged from photos at all.` }] }],
    json: true,
    maxOutputTokens: 500,
  });
  const r = parseJson<{ understood: boolean; name: string; look_for: string; min_duration_sec: number; alert_message: string; note: string }>(out);
  return {
    understood: !!r.understood,
    name: String(r.name ?? text).slice(0, 60),
    look_for: String(r.look_for ?? "").slice(0, 600),
    min_duration_sec: Math.max(0, Math.min(3600, Math.round(Number(r.min_duration_sec) || 0))),
    alert_message: String(r.alert_message ?? `matched "${text}"`).slice(0, 120),
    ai_note: String(r.note ?? "").slice(0, 300),
  };
}

type Snap = { id: string; key: string; taken_at: string };
type Match = { rule_id: string; confidence: number; reason: string };

async function framesParts(snaps: Snap[]): Promise<AiPart[]> {
  const parts: AiPart[] = [];
  for (const [i, s] of snaps.entries()) {
    const data = await getObject(s.key);
    if (!data || data.length > 2_500_000) continue;
    parts.push({ text: i === snaps.length - 1 ? "NEWEST photo (judge this one):" : `Earlier photo ${i + 1} (context only):` });
    parts.push({ image: { mime: "image/jpeg", data } });
  }
  return parts;
}

/** Asks the AI which rules the newest frame matches. */
export async function detect(rules: Rule[], frames: Snap[], workerName: string, budgetMs = 40_000): Promise<Match[]> {
  if (!rules.length || !frames.length) return [];
  const model = await getVisionModel(budgetMs);
  const list = rules.map((r) => `- id "${r.id}": ${r.name ?? r.text}. ${r.look_for ?? r.text}`).join("\n");
  const out = await model.generate({
    system: `You check photos from a camera on the glasses of ${workerName}, a shop worker (first-person view). ` +
      `Be strict: only report a rule if it is clearly visible in the NEWEST photo. Never guess.`,
    turns: [{ role: "user", parts: [
      ...(await framesParts(frames)),
      { text: `Rules:\n${list}\n\nReply with JSON only: {"matches":[{"rule_id":"…","confidence":0.0-1.0,"reason":"one short sentence of what you see"}]}. ` +
        `Use an empty list if no rule matches.` },
    ] }],
    json: true,
    maxOutputTokens: 400,
  });
  const r = parseJson<{ matches?: Match[] }>(out);
  const ids = new Set(rules.map((x) => x.id));
  return (r.matches ?? []).filter((m) => ids.has(m.rule_id)).map((m) => ({
    rule_id: m.rule_id, confidence: Math.max(0, Math.min(1, Number(m.confidence) || 0)), reason: String(m.reason ?? "").slice(0, 300),
  }));
}

export async function activeRules(workerId?: string): Promise<Rule[]> {
  const rules = (await sql`select * from alert_rules where understood and alert_enabled order by created_at`) as Rule[];
  return workerId ? rules.filter((r) => !r.worker_ids?.length || r.worker_ids.includes(workerId)) : rules;
}

/**
 * Called after a frame is saved. Throttled per phone to settings.check_every_sec.
 * Never throws: a busy AI just skips this frame.
 */
export async function checkFrame(deviceId: string, workerId: string, sessionId: string | null, snapshotId: string) {
  try {
    const s = await getSettings();
    if (!s.detection_enabled || !s.gemini_api_key) return;
    const claimed = await sql`update devices set last_check_at = now() where id = ${deviceId}
      and (last_check_at is null or last_check_at < now() - make_interval(secs => ${Math.max(3, s.check_every_sec) - 1})) returning id`;
    if (!claimed.length) return;
    const rules = await activeRules(workerId);
    if (!rules.length) return;
    const w = (await sql`select name from workers where id = ${workerId}`) as { name: string }[];
    const frames = ((await sql`select id, key, taken_at from snapshots where worker_id = ${workerId} and taken_at > now() - interval '2 minutes'
      and taken_at <= (select taken_at from snapshots where id = ${snapshotId}) order by taken_at desc limit 3`) as Snap[]).reverse();
    if (!frames.length || frames[frames.length - 1].id !== snapshotId) return;
    const matches = await detect(rules, frames, w[0]?.name ?? "the worker", 25_000);
    const matched = new Set<string>();
    for (const m of matches) {
      const rule = rules.find((r) => r.id === m.rule_id)!;
      if (m.confidence < rule.min_confidence) continue;
      matched.add(rule.id);
      await fire(rule, workerId, w[0]?.name ?? "Worker", sessionId, snapshotId, m, s.check_every_sec);
    }
  } catch (e) {
    console.warn("checkFrame skipped:", (e as Error).message);
  }
}

async function fire(rule: Rule, workerId: string, workerName: string, sessionId: string | null, snapshotId: string, m: Match, everySec: number) {
  // How long has this been going on? (gap tolerance: a few missed checks)
  const gap = Math.max(60, everySec * 3);
  const st = (await sql`insert into rule_state (rule_id, worker_id, first_seen, last_seen) values (${rule.id}, ${workerId}, now(), now())
    on conflict (rule_id, worker_id) do update set
      first_seen = case when rule_state.last_seen < now() - make_interval(secs => ${gap}) then now() else rule_state.first_seen end,
      last_seen = now()
    returning extract(epoch from (last_seen - first_seen))::int as lasted`) as { lasted: number }[];
  if ((st[0]?.lasted ?? 0) < rule.min_duration_sec) return;
  const recent = await sql`select 1 from alerts where rule_id = ${rule.id} and worker_id = ${workerId} and not false_alarm
    and created_at > now() - make_interval(secs => ${rule.cooldown_sec}) limit 1`;
  if (recent.length) return;
  const rows = (await sql`insert into alerts (rule_id, worker_id, session_id, snapshot_id, confidence, reason)
    values (${rule.id}, ${workerId}, ${sessionId}, ${snapshotId}, ${m.confidence}, ${m.reason}) returning id`) as { id: string }[];
  const today = ((await sql`select count(*)::int as n from alerts where rule_id = ${rule.id} and worker_id = ${workerId} and not false_alarm
    and (created_at at time zone 'Asia/Kolkata')::date = (now() at time zone 'Asia/Kolkata')::date`) as { n: number }[])[0].n;
  const snap = (await sql`select key from snapshots where id = ${snapshotId}`) as { key: string }[];
  const image = snap[0] ? await signedUrl(snap[0].key, 86_400) : null;
  const sent = await pushAll({
    title: `⚠ ${workerName} ${rule.alert_message ?? rule.name}`,
    body: `${m.reason} · ${today}× today`,
    url: `/alerts?focus=${rows[0].id}`,
    image,
    tag: `rule-${rule.id}-${workerId}`,
  }).catch(() => 0);
  await sql`update alerts set notified = ${sent > 0} where id = ${rows[0].id}`;
}

/** "Test" button: runs one rule over the last 12 frames of the most recent finished session. */
export async function testRule(ruleId: string) {
  const r = (await sql`select * from alert_rules where id = ${ruleId}`) as Rule[];
  if (!r[0]) throw new Error("Rule not found");
  const ses = (await sql`select s.id, w.name from sessions s join workers w on w.id = s.worker_id
    where s.snapshots > 0 order by s.started_at desc limit 1`) as { id: string; name: string }[];
  if (!ses[0]) return { checked: 0, matched: 0, examples: [] as string[], note: "No recorded session to test on yet." };
  const snaps = ((await sql`select id, key, taken_at from snapshots where session_id = ${ses[0].id} order by taken_at desc limit 12`) as Snap[]).reverse();
  const results: string[] = [];
  let matched = 0;
  // Check in 4 groups of up to 3 frames to keep it quick.
  for (let i = 0; i < snaps.length; i += 3) {
    const group = snaps.slice(i, i + 3);
    const ms = await detect([r[0]], group, ses[0].name, 20_000).catch(() => []);
    const hit = ms.find((m) => m.confidence >= r[0].min_confidence);
    if (hit) { matched++; results.push(hit.reason); }
  }
  return { checked: Math.ceil(snaps.length / 3), matched, examples: results.slice(0, 3), note: `Tested on ${ses[0].name}'s latest session.` };
}
