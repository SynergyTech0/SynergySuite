// Docs AI tools (through the suite's bring-your-own model, @synergy/ai):
// rewrite a selection in another tone, summarise, draft from a prompt, and
// fix grammar. The model answers in a small Markdown subset, turned here into
// document content (headings, paragraphs, lists, bold and italic).
import type { PMNode } from "./model";

export type AiTask = "rewrite" | "summarize" | "draft" | "grammar";
export const TONES = [
  { id: "clearer", label: "Clearer", hint: "clearer and easier to read" },
  { id: "shorter", label: "Shorter", hint: "shorter and more concise, keeping every key point" },
  { id: "longer", label: "More detailed", hint: "more detailed and complete, without inventing facts" },
  { id: "formal", label: "More formal", hint: "more formal and professional" },
  { id: "casual", label: "More casual", hint: "friendlier and more conversational" },
] as const;
export type Tone = (typeof TONES)[number]["id"];

export const AI_MAX_TEXT = 30000;

const MD_RULES = "Answer in Markdown using only: paragraphs separated by blank lines, '## ' and '### ' headings, '- ' bullet items, '1. ' numbered items, **bold** and *italic*. No preamble, no closing remarks, no code fences.";

/** System prompt and user message for a task. */
export function aiPrompt(task: AiTask, o: { text?: string; tone?: Tone; prompt?: string; context?: string }): { system: string; prompt: string; temperature: number; maxTokens: number } {
  const text = (o.text || "").slice(0, AI_MAX_TEXT);
  switch (task) {
    case "rewrite": {
      const tone = TONES.find((t) => t.id === o.tone) || TONES[0];
      return {
        system: `You are a careful editor. Rewrite the user's text to be ${tone.hint}. Keep its meaning, facts, names, numbers and language. Keep lists as lists. ${MD_RULES}`,
        prompt: text,
        temperature: 0.5,
        maxTokens: Math.min(4000, 400 + Math.ceil(text.length / 2)),
      };
    }
    case "summarize":
      return {
        system: `You summarise documents. Write a summary of the user's text: one short paragraph, then the key points as up to 6 '- ' bullet items. Use only what the text says, in its language. ${MD_RULES}`,
        prompt: text,
        temperature: 0.3,
        maxTokens: 1200,
      };
    case "grammar":
      return {
        system: "You are a proofreader. Correct the spelling, grammar and punctuation of the user's text. Change nothing else: keep the wording, tone, language and paragraph breaks. Answer with the corrected text only, paragraphs separated by blank lines, lists kept as '- ' or '1. ' items.",
        prompt: text,
        temperature: 0,
        maxTokens: Math.min(4000, 400 + Math.ceil(text.length / 2)),
      };
    case "draft":
      return {
        system: `You write clear, well-organised documents. Write what the user asks for, ready to use, in the language of the request. Start with the content (a '## ' heading per section when the piece has sections). ${MD_RULES}`,
        prompt: (o.context ? `The document so far (for context):\n"""\n${o.context.slice(0, 6000)}\n"""\n\n` : "") + `Write: ${(o.prompt || "").slice(0, 4000)}`,
        temperature: 0.7,
        maxTokens: 3000,
      };
  }
}

/** Remove what models add around an answer: code fences and a "Here is…:" lead-in. */
export function cleanAnswer(s: string): string {
  let t = s.replace(/\r\n/g, "\n").trim();
  t = t.replace(/^```(?:markdown|md|text)?\n([\s\S]*?)\n```$/i, "$1").trim();
  t = t.replace(/^(?:sure[,!.]?\s*)?here(?:'s| is| are)[^\n]*:\s*\n+/i, "").trim();
  return t;
}

/** Inline Markdown: **bold**, *italic* / _italic_; everything else is text. */
export function mdInline(s: string): PMNode[] {
  const out: PMNode[] = [];
  const re = /\*\*([^*]+)\*\*|\*([^*\s][^*]*)\*|(?<![\w])_([^_]+)_(?![\w])|`([^`]+)`/g;
  let last = 0;
  for (const m of s.matchAll(re)) {
    if (m.index! > last) out.push({ type: "text", text: s.slice(last, m.index) });
    if (m[1]) out.push({ type: "text", text: m[1], marks: [{ type: "bold" }] });
    else if (m[2] || m[3]) out.push({ type: "text", text: m[2] || m[3], marks: [{ type: "italic" }] });
    else out.push({ type: "text", text: m[4] });
    last = m.index! + m[0].length;
  }
  if (last < s.length) out.push({ type: "text", text: s.slice(last) });
  return out.filter((n) => n.text);
}

/** Markdown (the subset above) to document blocks. */
export function mdToNodes(md: string): PMNode[] {
  const out: PMNode[] = [];
  const lines = cleanAnswer(md).split("\n");
  let para: string[] = [];
  let list: { type: "bulletList" | "orderedList"; items: PMNode[] } | null = null;
  const flushPara = () => {
    if (para.length) out.push({ type: "paragraph", content: mdInline(para.join(" ").trim()) });
    para = [];
  };
  const flushList = () => {
    if (list) out.push({ type: list.type, content: list.items });
    list = null;
  };
  for (const raw of lines) {
    const line = raw.trimEnd();
    const h = /^(#{1,6})\s+(.*)$/.exec(line);
    const b = /^\s*[-*•]\s+(.*)$/.exec(line);
    const n = /^\s*\d+[.)]\s+(.*)$/.exec(line);
    if (!line.trim()) {
      flushPara();
      continue;
    }
    if (h) {
      flushPara();
      flushList();
      out.push({ type: "heading", attrs: { level: Math.min(3, Math.max(1, h[1].length - 1 || 1)) }, content: mdInline(h[2].replace(/#+\s*$/, "").trim()) });
    } else if (b || n) {
      flushPara();
      const type = b ? "bulletList" : "orderedList";
      const listNow = list as { type: "bulletList" | "orderedList"; items: PMNode[] } | null;
      if (!listNow || listNow.type !== type) {
        flushList();
        list = { type, items: [] };
      }
      list!.items.push({ type: "listItem", content: [{ type: "paragraph", content: mdInline((b || n)![1].trim()) }] });
    } else {
      flushList();
      para.push(line.trim());
    }
  }
  flushPara();
  flushList();
  return out.map((n) => (n.content && !n.content.length ? { type: n.type, ...(n.attrs ? { attrs: n.attrs } : {}) } : n));
}

/** Plain text of document blocks for the model: paragraphs separated by blank lines, list items as '- '. */
export function blocksText(nodes: PMNode[]): string {
  const out: string[] = [];
  const inline = (n: PMNode): string => (n.type === "text" ? n.text || "" : n.type === "hardBreak" ? "\n" : (n.content || []).map(inline).join(""));
  const walk = (n: PMNode, prefix = "") => {
    if (n.type === "paragraph" || n.type === "heading") {
      const t = inline(n).trim();
      if (t) out.push(prefix + (n.type === "heading" ? `## ${t}` : t));
    } else if (n.type === "bulletList" || n.type === "orderedList")
      (n.content || []).forEach((item, i) => (item.content || []).forEach((c, k) => walk(c, k === 0 ? (n.type === "bulletList" ? "- " : `${i + 1}. `) : "   ")));
    else (n.content || []).forEach((c) => walk(c, prefix));
  };
  // a run of inline content (part of one paragraph) reads as a paragraph
  const inlineOnly = nodes.length > 0 && nodes.every((n) => n.type === "text" || n.type === "hardBreak" || !n.content);
  if (inlineOnly) return nodes.map(inline).join("").trim();
  nodes.forEach((n) => walk(n));
  return out.join("\n\n");
}
