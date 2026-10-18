import { AiRequestError, AiUnavailableError, chat, isAiAvailable, loadAiConfig } from "@synergy/ai";
import type { Me } from "./api";
import { isRecruiter } from "./hire";
import { UserError, text } from "./util";

/**
 * A first draft of a job description on the suite's bring-your-own model (@synergy/ai): the AI_*
 * settings, or HIRE_AI_* to give Hire its own model. The recruiter edits it before anything is
 * published; nothing is saved here.
 */
export const AI_PREFIX = "HIRE_";

export function aiAvailable(): Promise<boolean> {
  return isAiAvailable({ prefix: AI_PREFIX });
}

export async function draftDescription(me: Me, b: Record<string, unknown>): Promise<{ description: string }> {
  if (!isRecruiter(me.email)) throw new UserError("Only recruiters can do that", 403);
  const title = text(b.title, 160);
  if (!title) throw new UserError("Give the job a title first");
  const cfg = await loadAiConfig({ prefix: AI_PREFIX }).catch((e) => {
    throw new UserError((e as Error).message, 503);
  });
  if (!cfg) throw new UserError("AI is off. An administrator can turn it on with the AI settings.", 503);
  const facts = [
    `Job title: ${title}`,
    text(b.department) && `Department: ${text(b.department, 120)}`,
    text(b.location) && `Location: ${text(b.location, 160)}${b.remote === true ? " (remote possible)" : ""}`,
    text(b.employmentType) && `Type: ${text(b.employmentType, 30).replace("_", " ")}`,
    text(b.salary) && `Pay: ${text(b.salary, 120)}`,
    text(b.notes) && `Notes from the recruiter:\n${text(b.notes, 4000)}`,
    text(b.description) && `Current draft to improve:\n${text(b.description, 8000)}`,
  ].filter(Boolean);
  try {
    const description = await chat({
      config: cfg,
      system:
        "You write job postings for a careers page. Use plain, inclusive language and short paragraphs with simple bullet lists " +
        "(lines starting with '- '). Sections: About the role, What you'll do, What you'll bring, Nice to have. " +
        "Never invent pay, benefits, company names or facts not given. No headline; the title is shown separately.",
      prompt: facts.join("\n"),
      maxTokens: 1200,
    });
    return { description: description.trim().slice(0, 20000) };
  } catch (e) {
    if (e instanceof AiUnavailableError) throw new UserError("AI is off. An administrator can turn it on with the AI settings.", 503);
    if (e instanceof AiRequestError) throw new UserError(`The AI model didn't answer: ${e.message}`, 502);
    throw e;
  }
}
