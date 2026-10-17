/**
 * The 3D modeling assistant (Chili3D's AI chat) runs its agent loop in the browser and calls its
 * model with Anthropic's or OpenAI's client. In the suite those clients point at this app
 * (`/api/ai/<protocol>`), which relays each call to the model the administrator configured for
 * the suite through @synergy/ai: AI_* settings, or CAD_AI_* to give CAD a different model.
 */
import { loadAiConfig, protocolOf, type AiConfig, type Protocol } from "@synergy/ai";

/** Requests carry the conversation and viewport screenshots; this is plenty. */
export const MAX_AI_REQUEST = 32 * 1024 * 1024;

export async function aiConfigForCad(env?: Record<string, string | undefined>): Promise<AiConfig | null> {
  try {
    return await loadAiConfig({ prefix: "CAD_", env });
  } catch {
    return null; // a misconfigured provider reads as AI off
  }
}

export type AssistantSettings = { enabled: false } | { enabled: true; protocol: Protocol; model: string };

/** What the 3D editor is told: off, or the protocol its client should speak and the model's name. */
export async function assistantSettings(env?: Record<string, string | undefined>): Promise<AssistantSettings> {
  const cfg = await aiConfigForCad(env);
  return cfg ? { enabled: true, protocol: protocolOf(cfg), model: cfg.model } : { enabled: false };
}

/** The one path each protocol's client posts to, or null for anything else. */
export function relayProtocol(name: string, path: string[]): Protocol | null {
  const joined = path.join("/");
  if (name === "anthropic" && joined === "v1/messages") return "anthropic";
  if (name === "openai" && joined === "chat/completions") return "openai";
  return null;
}
