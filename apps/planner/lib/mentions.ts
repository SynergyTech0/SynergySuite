/**
 * Client-safe mention helpers. The token format is `@[Display Name](user-uuid)`; lib/notify.ts parses
 * the same format on the server to decide who to notify.
 */
const TOKEN = /@\[([^\]\n]{1,100})\]\(([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\)/gi;

export type MentionPart = { text: string } | { mention: string; userId: string };

/** Split text into plain runs and mentions, for rendering mentions as chips without any HTML parsing. */
export function splitMentions(text: string): MentionPart[] {
  const parts: MentionPart[] = [];
  let last = 0;
  for (const m of text.matchAll(TOKEN)) {
    if (m.index! > last) parts.push({ text: text.slice(last, m.index) });
    parts.push({ mention: m[1], userId: m[2] });
    last = m.index! + m[0].length;
  }
  if (last < text.length) parts.push({ text: text.slice(last) });
  return parts;
}

/** For markdown: show a mention as bold "@Name" rather than letting `[Name](uuid)` become a link. */
export const mentionsToMarkdown = (text: string) => text.replace(TOKEN, (_t, name) => `**@${name.replace(/\*/g, "")}**`);

export const mentionToken = (name: string, userId: string) => `@[${name.replace(/[\]\n]/g, "")}](${userId})`;

/**
 * The "@partial" being typed at the caret, if any: an @ at the start or after whitespace, followed by
 * up to 30 non-space characters. Returns where it starts so the picker can replace it.
 */
export function activeMentionQuery(value: string, caret: number): { start: number; query: string } | null {
  const before = value.slice(0, caret);
  const m = before.match(/(^|\s)@([^\s@\[\]]{0,30})$/);
  if (!m) return null;
  return { start: caret - m[2].length - 1, query: m[2] };
}
