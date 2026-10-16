import { safeUrl } from "./render";
import { BLOCK_TYPES, type Block } from "./types";
import { UserError, text } from "./util";

/** Checks an email body sent by the browser: known block types, bounded text, safe links only. */
export function cleanBlocks(v: unknown): Block[] {
  if (v === undefined || v === null) return [];
  if (!Array.isArray(v)) throw new UserError("The email body must be a list of blocks");
  if (v.length > 200) throw new UserError("An email can have at most 200 blocks");
  const out: Block[] = [];
  for (const raw of v) {
    const b = (raw ?? {}) as Record<string, unknown>;
    const type = b.type as Block["type"];
    if (!BLOCK_TYPES.includes(type)) throw new UserError("Unknown block in the email");
    switch (type) {
      case "heading": out.push({ type, text: text(b.text, 300), level: b.level === 2 ? 2 : 1 }); break;
      case "text": out.push({ type, text: text(b.text, 20_000) }); break;
      case "button": out.push({ type, text: text(b.text, 80), url: safeUrl(text(b.url, 2000)), color: text(b.color, 7) || undefined }); break;
      case "image": out.push({ type, url: safeUrl(text(b.url, 2000)), alt: text(b.alt, 300), link: safeUrl(text(b.link, 2000)) || undefined }); break;
      case "divider": out.push({ type }); break;
      case "spacer": out.push({ type, height: Math.min(Math.max(Number(b.height) || 24, 4), 120) }); break;
    }
  }
  return out;
}

/** A starting body for a new email. */
export function starterBlocks(): Block[] {
  return [
    { type: "heading", text: "Hello {{first_name|default: there}}", level: 1 },
    { type: "text", text: "Write your message here. Use **bold**, *italic* and [links](https://example.com)." },
    { type: "button", text: "Learn more", url: "https://example.com" },
  ];
}
