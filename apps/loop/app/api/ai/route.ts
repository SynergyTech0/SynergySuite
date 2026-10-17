import { AiUnavailableError, chat, isAiAvailable, loadAiConfig, structured } from "@synergy/ai";
import { body, route } from "@/lib/api";
import { UserError, text } from "@/lib/util";

const AI = { prefix: "LOOP_" };

const SYSTEM =
  "You help a team write in a shared Loop workspace page. Answer in Markdown using only headings (#, ##), " +
  "paragraphs, - bullets, 1. numbered items, - [ ] checklist items, **bold** and _italic_. No tables, code or HTML. " +
  "Do not add a preamble or a closing remark.";

type Task = { title: string; assignee?: string; due?: string };

/**
 * Copilot for Loop pages, on the suite's own AI model (@synergy/ai, LOOP_AI_* overrides).
 *   draft:     { mode, prompt, context? }  -> { markdown }
 *   summarize: { mode, context }           -> { markdown }
 *   tasks:     { mode, context }           -> { tasks: [{ title, assignee, due }] }
 */
export const GET = route(async () => ({ enabled: await isAiAvailable(AI) }));

export const POST = route(async (_me, req) => {
  const b = await body<{ mode?: unknown; prompt?: unknown; context?: unknown }>(req);
  const context = text(b.context, 20_000);
  const prompt = text(b.prompt, 2_000);
  try {
    if (b.mode === "draft") {
      if (!prompt) throw new UserError("Say what to write");
      const markdown = await chat({
        system: SYSTEM,
        prompt: `${context ? `The page so far:\n"""\n${context}\n"""\n\n` : ""}Write this for the page: ${prompt}`,
        maxTokens: 1500,
        config: await loadAiConfig(AI),
      });
      return { markdown: markdown.trim() };
    }
    if (b.mode === "summarize") {
      if (!context) throw new UserError("There's nothing on the page to summarize yet");
      const markdown = await chat({
        system: SYSTEM,
        prompt: `Summarize this page in a few bullets, then list any decisions and open questions:\n"""\n${context}\n"""`,
        maxTokens: 800,
        config: await loadAiConfig(AI),
      });
      return { markdown: markdown.trim() };
    }
    if (b.mode === "tasks") {
      if (!context) throw new UserError("There's nothing on the page to find tasks in yet");
      const out = await structured<{ tasks: Task[] }>({
        system: "You find the action items in a team's notes. Only include things someone actually has to do.",
        prompt: `Find the action items in these notes. Use an email address or name for the assignee only when the notes name one, and a YYYY-MM-DD due date only when the notes give one.\n"""\n${context}\n"""`,
        toolName: "record_tasks",
        toolDescription: "Record the action items found in the notes",
        schema: {
          type: "object",
          properties: {
            tasks: {
              type: "array",
              items: {
                type: "object",
                properties: { title: { type: "string" }, assignee: { type: "string" }, due: { type: "string" } },
                required: ["title"],
              },
            },
          },
          required: ["tasks"],
        },
        maxTokens: 1200,
        config: await loadAiConfig(AI),
      });
      const tasks = (Array.isArray(out?.tasks) ? out.tasks : [])
        .map((t) => ({
          title: text(t?.title, 300),
          assignee: text(t?.assignee, 200),
          due: /^\d{4}-\d{2}-\d{2}$/.test(String(t?.due ?? "")) ? String(t.due) : "",
        }))
        .filter((t) => t.title)
        .slice(0, 50);
      return { tasks };
    }
    throw new UserError("Unknown request");
  } catch (err) {
    if (err instanceof AiUnavailableError) throw new UserError("AI isn't set up on this server. An administrator can turn it on in the admin console's AI model settings.", 503);
    throw err;
  }
});
