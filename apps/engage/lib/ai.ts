import { AiUnavailableError, aiConfig, chat } from "@synergy/ai";
import { feed, getPost, getCommunity } from "./engage";
import type { Post } from "./types";
import { UserError } from "./util";

/** Engage's AI uses the suite's model, or its own with ENGAGE_AI_* settings. */
const PREFIX = "ENGAGE_";

export function aiEnabled(): boolean {
  try {
    return !!aiConfig({ prefix: PREFIX });
  } catch {
    return false;
  }
}

function asText(p: Post): string {
  const head = [
    `${p.author.name} (${p.kind}${p.community ? ` in ${p.community.name}` : ""}, ${p.createdAt.slice(0, 10)})`,
    p.praised.length ? `Praising ${p.praised.map((x) => x.name).join(", ")}` : "",
    p.title,
    p.body,
    p.poll ? `Poll: ${p.poll.options.map((o) => `${o.label} (${o.votes})`).join(", ")}` : "",
  ].filter(Boolean);
  const replies = p.comments.map((c) => `  ${c.author.name}${c.id === p.bestAnswer ? " [best answer]" : ""}: ${c.body}`);
  return [...head, ...replies].join("\n").slice(0, 12_000);
}

async function ask(system: string, prompt: string): Promise<string> {
  try {
    return (await chat({ system, prompt, maxTokens: 700, temperature: 0.2, config: aiConfig({ prefix: PREFIX }) })).trim();
  } catch (e) {
    if (e instanceof AiUnavailableError) throw new UserError("AI is off. An admin can turn it on with the suite's AI settings.", 409);
    throw e;
  }
}

const SYSTEM =
  "You summarize posts from a company's internal social network for a busy colleague. Be brief and concrete, " +
  "use plain sentences or a few short bullet points, name people when it matters, and only use what is in the text.";

/** A short summary of one conversation: what was asked or said, and where the replies landed. */
export async function summarizePost(viewer: string, id: string): Promise<string> {
  const p = await getPost(viewer, id);
  return ask(SYSTEM, `Summarize this conversation in at most five bullet points.\n\n${asText(p)}`);
}

/** What happened lately in the viewer's feed, or in one community. */
export async function catchUp(viewer: string, community?: string): Promise<string> {
  const c = community ? await getCommunity(viewer, community) : null;
  const page = await feed(viewer, c ? { view: "community", community: c.id, limit: 30 } : { view: "home", limit: 30 });
  const since = Date.now() - 7 * 86_400_000;
  const recent = page.posts.filter((p) => Date.parse(p.activityAt) >= since);
  if (!recent.length) return c ? `Nothing new in ${c.name} this week.` : "Nothing new in your feed this week.";
  const fullPosts = await Promise.all(recent.slice(0, 15).map((p) => getPost(viewer, p.id)));
  const where = c ? `the ${c.name} community` : "their feed";
  return ask(
    SYSTEM,
    `Catch the reader up on the last week in ${where}: the announcements, decisions, open questions and anything that needs them. ` +
      `At most eight bullet points.\n\n${fullPosts.map(asText).join("\n\n---\n\n").slice(0, 30_000)}`,
  );
}
