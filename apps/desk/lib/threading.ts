// Ticket numbers and email threading. Pure functions: no database, no network.

/** T-2026-0001. Past 9999 in a year the number simply grows a digit. */
export function formatNumber(year: number, n: number): string {
  return `T-${year}-${String(n).padStart(4, "0")}`;
}

const TAG = /\bT-\d{4}-\d{4,}\b/;

/** The ticket number a subject carries, e.g. "Re: Printer [T-2026-0042]" -> "T-2026-0042". */
export function ticketTag(subject: string | null | undefined): string | null {
  const m = TAG.exec(subject || "");
  return m ? m[0] : null;
}

/** The subject of a staff reply: one "Re:", the ticket's subject, then its tag. */
export function replySubject(subject: string, number: string): string {
  const bare = subject
    .replace(/\s*\[T-\d{4}-\d{4,}\]\s*/g, " ")
    .replace(/^\s*((re|fw|fwd|aw|sv)\s*:\s*)+/i, "")
    .trim();
  return `Re: ${bare || "(no subject)"} [${number}]`;
}

/** "<abc@x>" form, so ids from mailparser and from nodemailer compare equal. */
export function normalizeMessageId(id: string | null | undefined): string | null {
  const v = String(id ?? "").trim();
  if (!v) return null;
  return v.startsWith("<") ? v : `<${v.replace(/>$/, "")}>`;
}

/**
 * The message ids an inbound email answers, nearest first: In-Reply-To, then References
 * from the most recent back. Any of them belonging to a ticket threads the email there.
 */
export function threadIds(inReplyTo?: string | null, references?: string | string[] | null): string[] {
  const refs = Array.isArray(references) ? references : String(references ?? "").split(/\s+/);
  const all = [inReplyTo ?? "", ...refs.slice().reverse()].map(normalizeMessageId).filter((x): x is string => !!x);
  return [...new Set(all)];
}

// Lines that start the quoted copy of an earlier message.
const QUOTE_HEADERS = [
  /^-{2,}\s*Original Message\s*-{2,}$/i,
  /^_{10,}$/, // Outlook puts a rule above its "From:/Sent:" block
  /^-{2,}\s*Forwarded message\s*-{2,}$/i,
  /^From:\s.+$/i, // only counts when a Sent:/Date: line follows (checked below)
];

/**
 * The new part of an email reply: everything above the quoted earlier message. Handles
 * "On <date>, <name> wrote:" (also when the client wraps it over two lines), Outlook's
 * "From: / Sent:" block and "-----Original Message-----", and trailing "> " lines.
 * Gives back the whole text if stripping would leave nothing.
 */
export function stripQuoted(text: string): string {
  const lines = String(text ?? "").replace(/\r\n?/g, "\n").split("\n");
  let cut = lines.length;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    const two = `${line} ${(lines[i + 1] ?? "").trim()}`;
    if (/^On\s.+\swrote:$/i.test(line) || (/^On\s/i.test(line) && /\swrote:$/i.test(two))) {
      cut = i;
      break;
    }
    if (QUOTE_HEADERS.slice(0, 3).some((re) => re.test(line))) {
      cut = i;
      break;
    }
    if (QUOTE_HEADERS[3].test(line) && /^(Sent|Date):\s/i.test((lines[i + 1] ?? "").trim())) {
      cut = i;
      break;
    }
  }
  const kept = lines.slice(0, cut);
  // A bottom block of "> " lines (and blank lines between them) is a quote, too.
  let end = kept.length;
  while (end > 0 && (/^\s*>/.test(kept[end - 1]) || !kept[end - 1].trim())) end--;
  const out = kept.slice(0, end).join("\n").trim();
  return out || String(text ?? "").trim();
}
