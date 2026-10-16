import { AiRequestError, AiUnavailableError, aiConfig, structured } from "@synergy/ai";
import { q } from "./db";
import { requireManager } from "./projects";
import { UserError, text } from "./util";

/**
 * Drafts a plan from the project's name and description with the suite's bring-your-own model
 * (@synergy/ai): the AI_* settings, or PROJECTS_AI_* to give Projects its own model. The draft
 * comes back for the manager to look at; nothing is added until they choose to.
 */
export const AI_PREFIX = "PROJECTS_";

export function planAiAvailable(): boolean {
  try {
    return !!aiConfig({ prefix: AI_PREFIX });
  } catch {
    return false;
  }
}

export type DraftPlan = {
  phases: { title: string; tasks: { title: string; durationDays: number; estimateHours?: number; milestone?: boolean }[] }[];
};

const SCHEMA = {
  type: "object",
  properties: {
    phases: {
      type: "array",
      description: "Three to eight phases in the order they happen.",
      items: {
        type: "object",
        properties: {
          title: { type: "string", description: "Phase name, a few words" },
          tasks: {
            type: "array",
            items: {
              type: "object",
              properties: {
                title: { type: "string", description: "What gets done, starting with a verb" },
                durationDays: { type: "integer", minimum: 1, maximum: 60, description: "Length in working days" },
                estimateHours: { type: "number", minimum: 0, description: "Effort in hours" },
                milestone: { type: "boolean", description: "A zero-length checkpoint, e.g. sign-off" },
              },
              required: ["title", "durationDays"],
            },
          },
        },
        required: ["title", "tasks"],
      },
    },
  },
  required: ["phases"],
};

export async function draftPlan(email: string, projectId: string, extra: unknown): Promise<DraftPlan> {
  await requireManager(email, projectId);
  const cfg = (() => {
    try {
      return aiConfig({ prefix: AI_PREFIX });
    } catch {
      return null;
    }
  })();
  if (!cfg) throw new UserError("AI is off: set AI_MODEL (or PROJECTS_AI_MODEL) to draft plans", 503);
  const [p] = await q<{ name: string; description: string; client_name: string }>(
    `SELECT name, description, client_name FROM projects WHERE id = $1::uuid`,
    [projectId],
  );
  const ask = [
    `Project: ${p.name}`,
    p.client_name ? `Client: ${p.client_name}` : "",
    p.description ? `Description: ${p.description}` : "",
    text(extra, 2000) ? `Notes from the manager: ${text(extra, 2000)}` : "",
  ].filter(Boolean).join("\n");
  try {
    const out = await structured<DraftPlan>({
      config: cfg,
      system: "You plan projects for a small professional services team. Break the project into phases and concrete tasks with realistic lengths and effort. Use plain names.",
      prompt: ask,
      toolName: "record_plan",
      toolDescription: "Record the drafted project plan",
      schema: SCHEMA,
      maxTokens: 4000,
    });
    const phases = Array.isArray(out?.phases) ? out.phases : [];
    return {
      phases: phases.slice(0, 12).map((ph) => ({
        title: text(ph?.title, 200),
        tasks: (Array.isArray(ph?.tasks) ? ph.tasks : []).slice(0, 30).map((t) => ({
          title: text(t?.title, 300),
          durationDays: Math.min(60, Math.max(1, Math.round(Number(t?.durationDays) || 1))),
          ...(Number(t?.estimateHours) > 0 ? { estimateHours: Math.round(Number(t.estimateHours) * 10) / 10 } : {}),
          ...(t?.milestone === true ? { milestone: true } : {}),
        })).filter((t) => t.title),
      })).filter((ph) => ph.tasks.length),
    };
  } catch (err) {
    if (err instanceof AiUnavailableError) throw new UserError(`AI is off: ${err.message}`, 503);
    if (err instanceof AiRequestError) throw new UserError(`The AI model refused: ${err.message}`, 502);
    throw err;
  }
}
