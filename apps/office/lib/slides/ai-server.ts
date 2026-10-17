// Server side of the Slides AI tools, through the suite's bring-your-own
// model (@synergy/ai): AI_* settings, or SLIDES_AI_* to give Slides its own.
import { AiRequestError, AiUnavailableError, loadAiConfig, structured, type AiConfig } from "@synergy/ai";
import { AI_IDEAS_SCHEMA, DRAFT_SCHEMA, cleanDraft, describeSlide, type Draft } from "./designer";
import type { Slide } from "./model";

export async function slidesAiConfig(env?: Record<string, string | undefined>): Promise<AiConfig | null> {
  try {
    return await loadAiConfig({ prefix: "SLIDES_", env });
  } catch {
    return null; // a misconfigured provider reads as AI off
  }
}

/** Layout ideas from the model: boxes for the slide's own objects (checked again in the browser). */
export async function aiDesignIdeas(slide: Slide, W: number, H: number, config: AiConfig): Promise<unknown[]> {
  const answer = await structured<{ ideas?: unknown[] }>({
    config,
    system:
      "You are a presentation designer. Given one slide's content and the boxes of its objects (pixels, origin top left), propose up to 3 distinct, polished layouts for the same content. " +
      "Move and resize the title, the body and each item by id; keep every box on the slide with comfortable margins, keep text readable and boxes from overlapping unless one is a background. " +
      "You may add a few plain decorative shapes (bands, panels, accent bars) in the theme accent ('accent') or neutral colours. Do not invent new text or pictures.",
    prompt: JSON.stringify(describeSlide(slide, W, H)),
    toolName: "propose_layouts",
    toolDescription: "Record the proposed layouts for the slide.",
    schema: AI_IDEAS_SCHEMA as unknown as Record<string, unknown>,
    maxTokens: 2000,
    temperature: 0.7,
  });
  return Array.isArray(answer?.ideas) ? answer.ideas.slice(0, 4) : [];
}

/** A deck drafted from a prompt. */
export async function aiDraftDeck(prompt: string, slides: number, config: AiConfig): Promise<Draft> {
  const n = Math.max(2, Math.min(20, Math.round(slides) || 8));
  const answer = await structured<unknown>({
    config,
    system: `You write clear, concise presentations. Draft a deck of about ${n} content slides (plus the title) for the request: each slide a short title and 2 to 5 brief bullet points of at most 12 words, with a sentence or two of speaker notes. Write in the language of the request.`,
    prompt: prompt.slice(0, 8000),
    toolName: "write_deck",
    toolDescription: "Record the drafted presentation.",
    schema: DRAFT_SCHEMA as unknown as Record<string, unknown>,
    maxTokens: 4000,
    temperature: 0.6,
  });
  const d = cleanDraft(answer, 30);
  if (!d || !d.slides.length) throw new AiRequestError("The model did not return any slides.");
  return d;
}

/** A user-facing message and HTTP status for an AI failure. */
export function aiFailure(e: unknown): { status: number; error: string } {
  if (e instanceof AiUnavailableError) return { status: 503, error: e.message };
  if (e instanceof AiRequestError) return { status: 502, error: `The AI model could not answer: ${e.message}` };
  return { status: 500, error: (e as Error)?.message || "AI request failed" };
}
