/**
 * AI model client for SynergySign's document intelligence, on the suite's shared bring-your-own-model
 * settings (@synergy/ai): AI_PROVIDER / AI_BASE_URL / AI_API_KEY / AI_MODEL, or SIGN_AI_* to give
 * sign its own model. Field placement reads page images, so pick a model that accepts images.
 *
 * Rule of the house: this layer NEVER fakes a result. If it can't do real analysis it says so, and
 * callers fall back to explicitly-labelled heuristics. The previous "AI" in this codebase was a
 * word-frequency counter and two hardcoded field coordinates presented as machine learning — that's
 * the thing we're deleting, so nothing here is allowed to quietly invent an answer.
 */

import { aiConfig, isAiConfigured as configured, structured, AiUnavailableError } from "@synergy/ai";

export { AiUnavailableError };

const PREFIX = "SIGN_";

export const AI_MODEL = aiConfig({ prefix: PREFIX })?.model ?? "";

export function isAiConfigured(): boolean {
  return configured({ prefix: PREFIX });
}

/**
 * Ask the model for a structured result via a forced tool call, so we get validated JSON back rather
 * than prose we'd have to regex. Returns the tool input object.
 */
export async function structuredCall<T>(opts: {
  system: string;
  prompt: string;
  /** Page images (base64 PNG), each preceded by its caption, sent after the prompt text. */
  images?: { caption: string; pngBase64: string }[];
  toolName: string;
  toolDescription: string;
  schema: Record<string, unknown>;
  maxTokens?: number;
}): Promise<T> {
  return structured<T>({
    config: aiConfig({ prefix: PREFIX }),
    system: opts.system,
    prompt: opts.prompt,
    images: opts.images?.map((im) => ({ caption: im.caption, base64: im.pngBase64, mediaType: "image/png" as const })),
    toolName: opts.toolName,
    toolDescription: opts.toolDescription,
    schema: opts.schema,
    maxTokens: opts.maxTokens ?? 4096,
  });
}
