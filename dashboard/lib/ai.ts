/**
 * Model-agnostic vision AI layer. Today: Google Gemini (generateContent REST API).
 * To add Claude or another model later, implement VisionModel and return it from getVisionModel().
 */
import { getSettings } from "./db";

export type AiPart = { text: string } | { image: { mime: string; data: Uint8Array } };
export type AiTurn = { role: "user" | "model"; parts: AiPart[] };

export interface VisionModel {
  readonly name: string;
  generate(opts: { system: string; turns: AiTurn[]; maxOutputTokens?: number; json?: boolean }): Promise<string>;
}

const GEMINI = "https://generativelanguage.googleapis.com/v1beta";

/** Gemini wants user/model turns to alternate: join neighbours with the same role. */
function mergeTurns(turns: AiTurn[]): AiTurn[] {
  const out: AiTurn[] = [];
  for (const t of turns) {
    const last = out[out.length - 1];
    if (last && last.role === t.role) last.parts = [...last.parts, ...t.parts];
    else out.push({ role: t.role, parts: [...t.parts] });
  }
  return out;
}

function b64(data: Uint8Array) { return Buffer.from(data).toString("base64"); }

export class GeminiModel implements VisionModel {
  constructor(private key: string, readonly name: string) {}

  async generate({ system, turns, maxOutputTokens = 2048, json = false }: Parameters<VisionModel["generate"]>[0]) {
    const body = {
      systemInstruction: { parts: [{ text: system }] },
      contents: mergeTurns(turns).map((t) => ({
        role: t.role,
        parts: t.parts.map((p) => ("text" in p ? { text: p.text } : { inlineData: { mimeType: p.image.mime, data: b64(p.image.data) } })),
      })),
      generationConfig: { maxOutputTokens, temperature: 0.3, ...(json ? { responseMimeType: "application/json" } : {}) },
    };
    const res = await fetch(`${GEMINI}/models/${encodeURIComponent(this.name)}:generateContent`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": this.key },
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new AiError(`Gemini ${this.name} ${res.status}: ${data?.error?.message ?? "request failed"}`, res.status);
    const cand = data?.candidates?.[0];
    const text = (cand?.content?.parts ?? []).map((p: { text?: string }) => p.text ?? "").join("").trim();
    if (!text) throw new AiError(`Gemini ${this.name} returned no text (${cand?.finishReason ?? data?.promptFeedback?.blockReason ?? "unknown"})`, 0);
    return text;
  }
}

/** Lists the Gemini models this key can use for generateContent (newest-looking first). */
export async function listGeminiModels(key: string): Promise<string[]> {
  const res = await fetch(`${GEMINI}/models?pageSize=200`, { headers: { "x-goog-api-key": key } });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error?.message ?? `Key check failed (${res.status})`);
  const names: string[] = (data.models ?? [])
    .filter((m: { supportedGenerationMethods?: string[] }) => m.supportedGenerationMethods?.includes("generateContent"))
    .map((m: { name: string }) => m.name.replace(/^models\//, ""))
    .filter((n: string) => /gemini/.test(n) && !/(tts|image|embedding|live|audio|veo|imagen|omni)/.test(n));
  return names.sort((a, b) => b.localeCompare(a, undefined, { numeric: true }));
}

export class AiError extends Error {
  constructor(message: string, readonly status: number) { super(message); }
}

/** Busy / rate-limited / temporary errors: try another model or try again later. */
export function isTemporary(e: unknown): boolean {
  if (e instanceof AiError) {
    if ([0, 408, 429, 500, 502, 503, 504].includes(e.status)) return true;
    if (e.status === 404 || e.status === 400) return /not found|not supported|unavailable|overloaded/i.test(e.message);
    return false;
  }
  return true; // network errors, timeouts
}

/**
 * Tries each model in order; if all are busy, waits and tries the list again, until [budgetMs]
 * runs out. Only then does it throw (callers queue the work instead of showing an error).
 */
export class FallbackModel implements VisionModel {
  constructor(private models: VisionModel[], private budgetMs = 45_000) {}
  get name() { return this.models.map((m) => m.name).join(" → "); }
  lastUsed = "";

  async generate(opts: Parameters<VisionModel["generate"]>[0]): Promise<string> {
    const t0 = Date.now();
    let last: unknown;
    for (let round = 0; ; round++) {
      for (const m of this.models) {
        try {
          const text = await m.generate(opts);
          this.lastUsed = m.name;
          return text;
        } catch (e) {
          last = e;
          if (!isTemporary(e)) {
            // A wrong/retired model name: skip it; a bad key: stop.
            if (e instanceof AiError && (e.status === 401 || e.status === 403)) throw e;
          }
          console.warn(`AI model ${m.name} failed: ${(e as Error).message}`);
        }
        if (Date.now() - t0 > this.budgetMs) throw new AiBusyError(last);
      }
      const wait = Math.min(8_000, 1_000 * 2 ** round);
      if (Date.now() - t0 + wait > this.budgetMs) throw new AiBusyError(last);
      await new Promise((r) => setTimeout(r, wait));
    }
  }
}

export class AiBusyError extends Error {
  constructor(readonly cause: unknown) { super(`All AI models are busy right now (${(cause as Error)?.message ?? "unknown"}). Will retry.`); }
}

let modelCache: { key: string; list: string[]; at: number } | null = null;

/** Ordered model list: the chosen model, the owner's backups, then other Flash models the key can use. */
export async function modelOrder(): Promise<{ key: string; models: string[] }> {
  const s = await getSettings();
  if (!s.gemini_api_key) throw new Error("Add your Gemini API key in Settings → AI first.");
  const chosen = [s.ai_model || "gemini-3.6-flash", ...(s.ai_models ?? "").split(",").map((x) => x.trim()).filter(Boolean)];
  let available: string[] = [];
  if (modelCache && modelCache.key === s.gemini_api_key && Date.now() - modelCache.at < 3_600_000) available = modelCache.list;
  else {
    try { available = await listGeminiModels(s.gemini_api_key); modelCache = { key: s.gemini_api_key, list: available, at: Date.now() }; }
    catch { available = []; }
  }
  const extras = available.filter((m) => /flash/.test(m) && !/preview|exp|thinking/.test(m)).slice(0, 4);
  const models = [...new Set([...chosen, ...extras])].filter((m) => !available.length || available.includes(m) || chosen.includes(m));
  return { key: s.gemini_api_key, models: models.slice(0, 6) };
}

export async function getVisionModel(budgetMs = 45_000): Promise<FallbackModel> {
  const { key, models } = await modelOrder();
  return new FallbackModel(models.map((m) => new GeminiModel(key, m)), budgetMs);
}

export const languageName = (l: string) => (l === "hi" ? "Hindi (Devanagari script, simple everyday words)" : "simple English");
