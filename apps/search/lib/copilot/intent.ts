import type { ActionKind } from "./actions";

/**
 * What the person asked for, read from their own words only: never from search results, the open
 * item, or the model's output. An action of a kind the person didn't ask for is dropped before it
 * is shown, so text inside an email or a document can't make Copilot propose one by itself.
 */

const KIND_WORDS: Record<ActionKind, RegExp> = {
  "todo.task": /\b(tasks?|to-?dos?|to do list|remind(?:er|ers)?|remind me)\b/i,
  "calendar.event": /\b(meetings?|events?|calendar|invites?|invitations?|schedule|appointments?|book (?:a |some )?time|set up a call|call with)\b/i,
  "mail.draft": /\b(e-?mails?|mail|reply|respond|write (?:back )?to)\b/i,
  "chat.message": /(\b(chat|channel|post|dm|direct message|teams message|message (?:the|in|on))\b|(^|\s)#[\p{L}\p{N}_-]+)/iu,
  "planner.card": /\b(cards?|planner|boards?|kanban|backlog)\b/i,
};

const ACT = /\b(create|add|make|set ?up|schedule|draft|write|send|post|remind|invite|book|put|plan|new|reply|respond|tell|let \S+ know|turn (?:this|that|it) into|log|file|open|start)\b/i;
const QUESTION = /^(what|when|who|whom|which|where|why|how|did|do|does|is|are|was|were|have|has|had|show|list|find|search)\b/i;
const POLITE = /\b(can|could|would|will) you\b|\bplease\b/i;
const SUMMARY = /\b(summari[sz]e|summary|tl;?dr|recap|catch me up|key points|gist)\b/i;

export type Mode = "actions" | "summary" | "answer";

/** The action kinds the person's message asks for. */
export function requestedKinds(message: string): ActionKind[] {
  return (Object.keys(KIND_WORDS) as ActionKind[]).filter((k) => KIND_WORDS[k].test(message));
}

/** How to handle the message: propose actions, summarize the open item, or answer from their content. */
export function modeOf(message: string, hasContext: boolean): Mode {
  const m = message.trim();
  const kinds = requestedKinds(m);
  const asks = ACT.test(m) && (!QUESTION.test(m) || POLITE.test(m));
  if (kinds.length && asks) return "actions";
  if (SUMMARY.test(m) && hasContext) return "summary";
  return "answer";
}
