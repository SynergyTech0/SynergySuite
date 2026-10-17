/**
 * draw.io's own AI window (Generate, and asking about or changing the open diagram) in the suite.
 * Upstream it calls an outside AI service from the browser with a key typed into the editor;
 * here the editor is configured with one model, "the suite's model", whose endpoint is this app
 * (/api/ai/chat, in OpenAI's chat format). That route hands the conversation to @synergy/ai, so
 * the administrator's AI_* settings (or DIAGRAMS_AI_* for a model of its own) decide what answers
 * and the browser never holds a key.
 */
import { loadAiConfig, type AiConfig } from "@synergy/ai";

export const AI_PREFIX = "DIAGRAMS_";

/** The prompt carries the open diagram for "change my diagram"; diagrams can be large. */
export const MAX_AI_REQUEST = 8 * 1024 * 1024;

export async function aiConfigForDiagrams(env?: Record<string, string | undefined>): Promise<AiConfig | null> {
  try {
    return await loadAiConfig({ prefix: AI_PREFIX, env });
  } catch {
    return null; // a misconfigured provider reads as AI off
  }
}

/** The draw.io settings that point its AI window at /api/ai/chat; empty when no model is set. */
export async function editorAiSettings(env?: Record<string, string | undefined>): Promise<Record<string, unknown>> {
  const cfg = await aiConfigForDiagrams(env);
  if (!cfg) return { enableAi: false };
  return {
    enableAi: true,
    // createPublic is draw.io's own hosted generator; the rest go to the suite.
    aiActions: ["create", "update", "assist"],
    aiConfigs: {
      synergy: {
        // draw.io only lists a model whose key is set (gptApiKey below). It is a placeholder:
        // no header carries it, the server holds the real key.
        apiKey: "gptApiKey",
        endpoint: "/api/ai/chat",
        requestHeaders: {},
        request: {
          model: "{model}",
          messages: [
            { role: "system", content: "{action}" },
            { role: "user", content: "{prompt}" },
          ],
        },
        responsePath: "$.choices[0].message.content",
      },
    },
    aiModels: [{ name: `Suite model (${cfg.model})`, model: "suite", config: "synergy" }],
    // Setting aiGlobals would replace draw.io's own instructions for each action, so only the key.
    gptApiKey: "suite",
  };
}

export type ChatMessage = { role: string; content: string };

export class AiInputError extends Error {}

/** The system and user text of an OpenAI-format request from the editor. */
export function readChat(body: unknown): { system: string; prompt: string } {
  const messages = (body as { messages?: unknown } | null)?.messages;
  if (!Array.isArray(messages) || !messages.length || messages.length > 20) throw new AiInputError("messages must be a short list");
  const system: string[] = [];
  const user: string[] = [];
  for (const m of messages as ChatMessage[]) {
    if (!m || typeof m.content !== "string") throw new AiInputError("Each message needs text content");
    if (m.role === "system") system.push(m.content);
    else user.push(m.content);
  }
  const prompt = user.join("\n\n").trim();
  if (!prompt) throw new AiInputError("Say what the diagram should show");
  return { system: system.join("\n\n"), prompt };
}
