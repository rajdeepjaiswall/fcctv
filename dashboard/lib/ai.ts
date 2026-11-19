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
    if (!res.ok) throw new Error(`Gemini ${res.status}: ${data?.error?.message ?? "request failed"}`);
    const cand = data?.candidates?.[0];
    const text = (cand?.content?.parts ?? []).map((p: { text?: string }) => p.text ?? "").join("").trim();
    if (!text) throw new Error(`Gemini returned no text (${cand?.finishReason ?? data?.promptFeedback?.blockReason ?? "unknown"})`);
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

export async function getVisionModel(): Promise<VisionModel> {
  const s = await getSettings();
  if (!s.gemini_api_key) throw new Error("Add your Gemini API key in Settings → AI first.");
  return new GeminiModel(s.gemini_api_key, s.ai_model || "gemini-3.6-flash");
}

export const languageName = (l: string) => (l === "hi" ? "Hindi (Devanagari script, simple everyday words)" : "simple English");
