/**
 * Session analysis:
 *  1. Every `summary_batch` photos (default 10) become one plain-language note on the session timeline
 *     ("Worker is packing boxes at the counter, then served two customers").
 *  2. When the session stops, the remaining photos are noted and a final summary is written. The
 *     summary is also the first message of the session's chat, where the owner can ask questions.
 * Work is done in small steps (one AI call per step) so it fits serverless time limits; steps are
 * triggered after uploads/stop and by the session page while it is open.
 */
import { sql, getSettings } from "./db";
import { getObject } from "./r2";
import { getVisionModel, languageName, type AiPart } from "./ai";

type Snap = { id: string; key: string; taken_at: string };
type Session = {
  id: string; worker_id: string; worker_name: string; mode: string; status: string; started_at: string; ended_at: string | null;
  summary: string | null;
};

const MAX_IMAGES_PER_CALL = 16;
const MAX_IMAGE_BYTES = 2_500_000;

const ist = (iso: string) => new Date(iso).toLocaleTimeString("en-IN", { timeZone: "Asia/Kolkata", hour: "2-digit", minute: "2-digit", second: "2-digit" });

function sample<T>(items: T[], n: number): T[] {
  if (items.length <= n) return items;
  const out: T[] = [];
  for (let i = 0; i < n; i++) out.push(items[Math.round((i * (items.length - 1)) / (n - 1))]);
  return out;
}

async function imageParts(snaps: Snap[]): Promise<AiPart[]> {
  const parts: AiPart[] = [];
  const loaded = await Promise.all(snaps.map(async (s) => ({ s, data: await getObject(s.key) })));
  loaded.forEach(({ s, data }, i) => {
    if (!data || data.length > MAX_IMAGE_BYTES) return;
    parts.push({ text: `Photo ${i + 1} at ${ist(s.taken_at)}:` });
    parts.push({ image: { mime: "image/jpeg", data } });
  });
  return parts;
}

const SYSTEM = (workerName: string, lang: string) =>
  `You review photos from a body-worn camera (smart glasses) worn by ${workerName}, a worker at a small shop in India. ` +
  `The photos show what the worker sees. Describe only what is visible: the worker's activity, customers served, ` +
  `items handled, phone use, idle time. Never guess identities. Be factual and brief. Write in ${languageName(lang)}.`;

async function loadSession(id: string): Promise<Session | null> {
  const rows = (await sql`select s.id, s.worker_id, w.name as worker_name, s.mode, s.status, s.started_at, s.ended_at, s.summary
    from sessions s join workers w on w.id = s.worker_id where s.id = ${id}`) as Session[];
  return rows[0] ?? null;
}

/** Takes the AI lock for this session for 90 s; false if another step is running. */
async function lock(id: string): Promise<boolean> {
  const r = await sql`update sessions set ai_lock_until = now() + interval '90 seconds'
    where id = ${id} and (ai_lock_until is null or ai_lock_until < now()) returning id`;
  return r.length > 0;
}
const unlock = (id: string) => sql`update sessions set ai_lock_until = null where id = ${id}`;

export type StepResult = { state: "working" | "waiting" | "done" | "failed" | "busy"; notes: number; total: number; error?: string };

/** Runs at most one AI call for this session. */
export async function analyseStep(sessionId: string): Promise<StepResult> {
  const session = await loadSession(sessionId);
  if (!session) return { state: "failed", notes: 0, total: 0, error: "Session not found" };
  const s = await getSettings();
  const batch = Math.min(Math.max(s.summary_batch || 10, 3), 60);
  const snaps = (await sql`select id, key, taken_at from snapshots where session_id = ${sessionId} order by taken_at`) as Snap[];
  const noteCount = ((await sql`select count(*)::int as n from session_notes where session_id = ${sessionId}`) as { n: number }[])[0].n;
  const ended = !!session.ended_at;
  const base = { notes: noteCount, total: snaps.length };

  if (session.status === "done") return { state: "done", ...base };
  if (!s.gemini_api_key) {
    if (ended) await sql`update sessions set status = 'done', ai_error = 'No Gemini key set' where id = ${sessionId}`;
    return { state: ended ? "done" : "waiting", ...base, error: "No Gemini API key in Settings" };
  }
  const from = noteCount * batch;
  const chunk = snaps.slice(from, from + batch);
  const fullBatchReady = chunk.length === batch;
  const needNote = fullBatchReady || (ended && chunk.length > 0);
  if (!needNote && !ended) return { state: "waiting", ...base };

  if (!(await lock(sessionId))) return { state: "busy", ...base };
  try {
    const model = await getVisionModel();
    if (needNote) {
      const parts = await imageParts(sample(chunk, MAX_IMAGES_PER_CALL));
      const text = await model.generate({
        system: SYSTEM(session.worker_name, s.ai_language),
        turns: [{ role: "user", parts: [
          ...parts,
          { text: `These ${chunk.length} photos were taken between ${ist(chunk[0].taken_at)} and ${ist(chunk[chunk.length - 1].taken_at)}. ` +
            `In 1-2 short sentences, say what ${session.worker_name} was doing in this period, in order.` },
        ] }],
        maxOutputTokens: 300,
      });
      await sql`insert into session_notes (session_id, idx, from_at, to_at, text, snapshot_ids)
        values (${sessionId}, ${noteCount}, ${chunk[0].taken_at}, ${chunk[chunk.length - 1].taken_at}, ${text}, ${chunk.map((c) => c.id)}::uuid[])
        on conflict (session_id, idx) do nothing`;
      await sql`update sessions set analysed_count = ${from + chunk.length}, ai_error = null where id = ${sessionId}`;
      await sql`insert into events (worker_id, type, message, data) values (${session.worker_id}, 'ai_note', ${text},
        ${JSON.stringify({ session_id: sessionId, idx: noteCount })}::jsonb)`;
      return { state: "working", notes: noteCount + 1, total: snaps.length };
    }

    // Ended and every photo is noted: write the final summary.
    if (snaps.length === 0) {
      await sql`update sessions set status = 'empty', summary = ${"No photos were captured in this session."} where id = ${sessionId}`;
      return { state: "done", ...base };
    }
    const notes = (await sql`select from_at, to_at, text from session_notes where session_id = ${sessionId} order by idx`) as { from_at: string; to_at: string; text: string }[];
    const timeline = notes.map((n) => `${ist(n.from_at)}–${ist(n.to_at)}: ${n.text}`).join("\n");
    const parts = await imageParts(sample(snaps, 8));
    const summary = await model.generate({
      system: SYSTEM(session.worker_name, s.ai_language),
      turns: [{ role: "user", parts: [
        ...parts,
        { text: `Session from ${ist(session.started_at)} to ${ist(session.ended_at!)} (${snaps.length} photos, ${session.mode} mode).\n` +
          `Timeline notes:\n${timeline}\n\nWrite a short report for the shop owner: 1) a 2-3 sentence overview of what ` +
          `${session.worker_name} did and how well they were working, 2) up to 5 bullet points of notable moments with times ` +
          `(phone use, idle time, cash handling, customers). Plain text, no markdown headings.` },
      ] }],
      maxOutputTokens: 900,
    });
    await sql`update sessions set summary = ${summary}, status = 'done', ai_error = null where id = ${sessionId}`;
    await sql`insert into session_messages (session_id, role, content) values (${sessionId}, 'assistant', ${summary})`;
    await sql`insert into events (worker_id, type, message, data) values (${session.worker_id}, 'ai_summary',
      ${`Session summary ready: ${summary.slice(0, 160)}`}, ${JSON.stringify({ session_id: sessionId })}::jsonb)`;
    return { state: "done", notes: notes.length, total: snaps.length };
  } catch (e) {
    const msg = (e as Error).message;
    await sql`update sessions set ai_error = ${msg} where id = ${sessionId}`;
    return { state: "failed", ...base, error: msg };
  } finally {
    await unlock(sessionId);
  }
}

/** Runs steps until done or ~50 s have passed (for use in background after()). */
export async function analyseFor(sessionId: string, budgetMs = 50_000) {
  const t0 = Date.now();
  while (Date.now() - t0 < budgetMs) {
    const r = await analyseStep(sessionId);
    if (r.state !== "working") return r;
  }
}

/** Owner asks a question in the session chat. */
export async function askSession(sessionId: string, question: string): Promise<string> {
  const session = await loadSession(sessionId);
  if (!session) throw new Error("Session not found");
  const s = await getSettings();
  const model = await getVisionModel();
  const notes = (await sql`select from_at, to_at, text from session_notes where session_id = ${sessionId} order by idx`) as { from_at: string; to_at: string; text: string }[];
  const snaps = (await sql`select id, key, taken_at from snapshots where session_id = ${sessionId} order by taken_at`) as Snap[];
  const history = (await sql`select role, content from session_messages where session_id = ${sessionId} order by created_at desc limit 12`) as { role: string; content: string }[];
  history.reverse();
  await sql`insert into session_messages (session_id, role, content) values (${sessionId}, 'user', ${question})`;

  const context =
    `Session of ${session.worker_name}: ${ist(session.started_at)} to ${session.ended_at ? ist(session.ended_at) : "now (still recording)"}, ` +
    `${snaps.length} photos.\nTimeline notes:\n${notes.map((n) => `${ist(n.from_at)}–${ist(n.to_at)}: ${n.text}`).join("\n") || "(none yet)"}\n` +
    (session.summary ? `Summary:\n${session.summary}\n` : "");
  const turns = [
    { role: "user" as const, parts: [...(await imageParts(sample(snaps, 12))), { text: `${context}\nYou will now answer the owner's questions about this session.` }] },
    { role: "model" as const, parts: [{ text: "Understood. Ask me anything about this session." }] },
    ...history.map((m) => ({ role: (m.role === "assistant" ? "model" : "user") as "user" | "model", parts: [{ text: m.content }] })),
    { role: "user" as const, parts: [{ text: question }] },
  ];
  const answer = await model.generate({
    system: SYSTEM(session.worker_name, s.ai_language) + " Answer the owner's question using the photos and notes; say so if the photos don't show it.",
    turns,
    maxOutputTokens: 800,
  });
  await sql`insert into session_messages (session_id, role, content) values (${sessionId}, 'assistant', ${answer})`;
  return answer;
}
