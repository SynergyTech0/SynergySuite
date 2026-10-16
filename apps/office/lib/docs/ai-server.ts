// Server side of the Docs AI tools, through the suite's bring-your-own model
// (@synergy/ai): AI_* settings, or DOCS_AI_* to give Docs its own.
import { AiRequestError, AiUnavailableError, aiConfig, chat, type AiConfig } from "@synergy/ai";
import { aiPrompt, cleanAnswer, type AiTask, type Tone } from "./ai";

export const AI_TASKS: AiTask[] = ["rewrite", "summarize", "draft", "grammar"];

export function docsAiConfig(env?: Record<string, string | undefined>): AiConfig | null {
  try {
    return aiConfig({ prefix: "DOCS_", env });
  } catch {
    return null; // a misconfigured provider reads as AI off
  }
}

/** The model's Markdown answer for a task. */
export async function aiDocsTask(task: AiTask, o: { text?: string; tone?: Tone; prompt?: string; context?: string }, config: AiConfig): Promise<string> {
  const p = aiPrompt(task, o);
  const answer = cleanAnswer(await chat({ config, system: p.system, prompt: p.prompt, temperature: p.temperature, maxTokens: p.maxTokens }));
  if (!answer) throw new AiRequestError("The model returned an empty answer.");
  return answer;
}

/** A user-facing message and HTTP status for an AI failure. */
export function docsAiFailure(e: unknown): { status: number; error: string } {
  if (e instanceof AiUnavailableError) return { status: 503, error: e.message };
  if (e instanceof AiRequestError) return { status: 502, error: `The AI model could not answer: ${e.message}` };
  return { status: 500, error: (e as Error)?.message || "AI request failed" };
}
