/**
 * Sticky-note ideas from the suite's bring-your-own model (@synergy/ai): the AI_* settings, or
 * WHITEBOARD_AI_* to give Whiteboard a model of its own. Only the prompt and the words already
 * on the board are sent; nothing is drawn until the person adds the notes.
 */
import { AiRequestError, AiUnavailableError, loadAiConfig, structured, type AiConfig } from "@synergy/ai";
import { UserError, text } from "./util";

export const MAX_IDEAS = 12;

export async function boardAiConfig(env?: Record<string, string | undefined>): Promise<AiConfig | null> {
  try {
    return await loadAiConfig({ prefix: "WHITEBOARD_", env });
  } catch {
    return null; // a misconfigured provider reads as AI off
  }
}

const SCHEMA = {
  type: "object",
  properties: {
    ideas: {
      type: "array",
      items: { type: "string", description: "One idea, at most 12 words, written to fit on a sticky note." },
      description: `Between 4 and ${MAX_IDEAS} distinct ideas.`,
    },
  },
  required: ["ideas"],
};

const SYSTEM =
  "You help a team brainstorm on a shared whiteboard. Answer with short, concrete, distinct ideas, each one fitting on a sticky note " +
  "(at most 12 words, no numbering, no quotes). Don't repeat what is already on the board. Write in the language of the request.";

/** Ideas for `prompt`, given the words already on the board. */
export async function ideas(prompt: unknown, onBoard: unknown, cfg?: AiConfig | null): Promise<string[]> {
  const ask = text(prompt, 1000);
  if (!ask) throw new UserError("Say what the ideas are for");
  const config = cfg === undefined ? await boardAiConfig() : cfg;
  if (!config) throw new UserError("AI isn't set up for this suite. An administrator can turn it on in the admin console's AI model settings.", 503);
  const existing = text(onBoard, 6000);
  try {
    const answer = await structured<{ ideas?: unknown }>({
      config,
      system: SYSTEM,
      prompt: `${existing ? `Already on the board:\n${existing}\n\n` : ""}Request: ${ask}`,
      toolName: "record_ideas",
      toolDescription: "Record the sticky-note ideas.",
      schema: SCHEMA,
      maxTokens: 800,
      temperature: 0.8,
    });
    const list = Array.isArray(answer?.ideas) ? answer.ideas : [];
    const seen = new Set<string>();
    return list
      .map((i) => text(i, 140).replace(/^[-*\d.)\s]+/, ""))
      .filter((i) => i && !seen.has(i.toLowerCase()) && seen.add(i.toLowerCase()))
      .slice(0, MAX_IDEAS);
  } catch (err) {
    if (err instanceof AiUnavailableError) throw new UserError("AI isn't set up for this suite", 503);
    if (err instanceof AiRequestError) throw new UserError("The AI model didn't answer. Try again in a moment.", 502);
    throw err;
  }
}
