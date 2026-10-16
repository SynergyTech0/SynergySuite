import { createHash } from "node:crypto";
import { simpleParser, type AddressObject, type ParsedMail } from "mailparser";
import type { ParsedQuery } from "@synergy/compliance";

/**
 * One message as eDiscovery sees it, worked out the same way for a live message and a preserved
 * one so a query finds the same things in both. `searchText` is what keywords are matched
 * against: subject, every address and name, the body, and attachment names.
 */
export type MailDoc = {
  hash: string; // sha256 of the raw message
  messageId: string | null;
  subject: string;
  from: string[];
  to: string[];
  cc: string[];
  bcc: string[];
  date: Date | null;
  size: number;
  body: string; // plain text
  searchText: string;
  parsed: ParsedMail;
};

export const hashOf = (raw: Buffer) => createHash("sha256").update(raw).digest("hex");

const list = (a?: AddressObject | AddressObject[]) => (Array.isArray(a) ? a : a ? [a] : []).flatMap((x) => x.value);
const addrs = (a?: AddressObject | AddressObject[]) => list(a).map((v) => (v.address || "").toLowerCase()).filter(Boolean);
const names = (a?: AddressObject | AddressObject[]) => list(a).map((v) => `${v.name || ""} ${v.address || ""}`.trim());

const stripHtml = (html: string) => html.replace(/<(style|script)[\s\S]*?<\/\1>/gi, " ").replace(/<[^>]+>/g, " ")
  .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'");

export async function describe(raw: Buffer, internalDate?: Date | null): Promise<MailDoc> {
  const parsed = await simpleParser(raw);
  const body = (parsed.text || (parsed.html ? stripHtml(parsed.html) : "")).replace(/\s+/g, " ").trim();
  const searchText = [
    parsed.subject || "",
    ...names(parsed.from), ...names(parsed.to), ...names(parsed.cc), ...names(parsed.bcc),
    body,
    ...parsed.attachments.map((a) => a.filename || ""),
  ].join("\n");
  return {
    hash: hashOf(raw),
    messageId: parsed.messageId || null,
    subject: parsed.subject || "",
    from: addrs(parsed.from),
    to: addrs(parsed.to),
    cc: addrs(parsed.cc),
    bcc: addrs(parsed.bcc),
    date: parsed.date && !Number.isNaN(parsed.date.getTime()) ? parsed.date : internalDate ?? null,
    size: raw.length,
    body,
    searchText,
    parsed,
  };
}

/** About 200 characters of plain text around the first word of the query found in it. */
export function snippet(text: string, p: ParsedQuery): string {
  const t = text.replace(/\s+/g, " ").trim();
  const lower = t.toLowerCase();
  const at = p.groups.flat().map((term) => lower.indexOf(term)).filter((i) => i >= 0).sort((a, b) => a - b)[0] ?? 0;
  const start = Math.max(0, at - 60);
  const cut = t.slice(start, start + 200);
  return (start > 0 ? "…" : "") + cut + (start + 200 < t.length ? "…" : "");
}

/** Everyone on the message but its owner. */
export function participants(d: Pick<MailDoc, "from" | "to" | "cc" | "bcc">, owner: string): string[] {
  return [...new Set([...d.from, ...d.to, ...d.cc, ...d.bcc])].filter((a) => a !== owner);
}
