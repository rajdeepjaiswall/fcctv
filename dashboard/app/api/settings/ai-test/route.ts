import { getSettings } from "@/lib/db";
import { admin, json } from "@/lib/http";
import { GeminiModel, listGeminiModels } from "@/lib/ai";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

/** "Test key": lists the models the saved key can use and runs a one-line test with the chosen model. */
export const POST = admin(async () => {
  const s = await getSettings();
  if (!s.gemini_api_key) return json({ ok: false, error: "No key saved yet." });
  try {
    const models = await listGeminiModels(s.gemini_api_key);
    const reply = await new GeminiModel(s.gemini_api_key, s.ai_model).generate({
      system: "Reply with exactly: OK", turns: [{ role: "user", parts: [{ text: "Test" }] }], maxOutputTokens: 20,
    });
    return json({ ok: true, models, reply: reply.slice(0, 40) });
  } catch (e) {
    let models: string[] = [];
    try { models = await listGeminiModels(s.gemini_api_key); } catch { /* key itself is bad */ }
    return json({ ok: false, error: (e as Error).message, models });
  }
});
