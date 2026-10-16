import { AiRequestError, AiUnavailableError, aiConfig, structured } from "@synergy/ai";
import { q } from "./db";
import { requireDispatcher } from "./staff";
import { UserError, text } from "./util";
import { access, assertOpen } from "./workorders";

/**
 * Drafts the steps for a job from its description and equipment with the suite's bring-your-own
 * model (@synergy/ai): the AI_* settings, or FIELD_AI_* to give Field Service its own model. The
 * draft comes back for the dispatcher to look at; nothing is added until they choose to.
 */
export const AI_PREFIX = "FIELD_";

function config() {
  try {
    return aiConfig({ prefix: AI_PREFIX });
  } catch {
    return null;
  }
}

export function aiAvailable(): boolean {
  return !!config();
}

const SCHEMA = {
  type: "object",
  properties: {
    steps: {
      type: "array",
      description: "Three to twelve steps in the order a technician does them on site.",
      items: { type: "string", description: "One step, starting with a verb, under 15 words" },
    },
  },
  required: ["steps"],
};

export async function draftChecklist(me: string, id: string): Promise<{ steps: string[] }> {
  await requireDispatcher(me);
  await access(me, id);
  await assertOpen(id);
  const cfg = config();
  if (!cfg) throw new UserError("AI is off: set AI_MODEL (or FIELD_AI_MODEL) to draft steps", 503);
  const [w] = await q<{ title: string; description: string; kind: string; asset: string | null }>(
    `SELECT w.title, w.description, w.kind, concat_ws(' ', a.name, a.make, a.model) AS asset
     FROM work_orders w LEFT JOIN assets a ON a.id = w.asset_id WHERE w.id = $1`,
    [id],
  );
  const prompt = [`Job (${w.kind}): ${w.title}`, w.asset ? `Equipment: ${w.asset}` : "", w.description ? `Details: ${text(w.description, 3000)}` : ""]
    .filter(Boolean)
    .join("\n");
  try {
    const out = await structured<{ steps: string[] }>({
      config: cfg,
      system: "You write on-site checklists for field service technicians. Keep steps concrete and safe, in the order they are done. Include safety isolation where the equipment needs it.",
      prompt,
      toolName: "record_steps",
      toolDescription: "Record the drafted checklist",
      schema: SCHEMA,
      maxTokens: 1500,
    });
    const steps = (Array.isArray(out?.steps) ? out.steps : []).map((s) => text(s, 300)).filter(Boolean).slice(0, 20);
    return { steps };
  } catch (err) {
    if (err instanceof AiUnavailableError) throw new UserError(`AI is off: ${err.message}`, 503);
    if (err instanceof AiRequestError) throw new UserError(`The AI model refused: ${err.message}`, 502);
    throw err;
  }
}
