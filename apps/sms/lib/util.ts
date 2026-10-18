export class UserError extends Error {
  constructor(message: string, public status = 400) {
    super(message);
  }
}

/** Trimmed text, cut to `max` characters. */
export function text(v: unknown, max = 500): string {
  return String(v ?? "").replace(/\u0000/g, "").trim().slice(0, max);
}

/** The longest text accepted: ten SMS segments. */
export const MAX_BODY = 1600;

/**
 * A phone number as E.164 (+15551234567), or "" when it can't be one. "+" or "00" numbers keep
 * their country code; anything else gets `country` (default 1), dropping a national leading 0.
 * In North America (1), a 10-digit number gets +1 and an 11-digit one starting with 1 gets +.
 */
export function e164(raw: unknown, country = process.env.SMS_DEFAULT_COUNTRY_CODE || "1"): string {
  const s = String(raw ?? "").trim();
  let digits = s.replace(/\D/g, "");
  if (!digits) return "";
  let out: string;
  if (s.startsWith("+")) out = `+${digits}`;
  else if (digits.startsWith("00")) out = `+${digits.slice(2)}`;
  else if (country === "1") {
    if (digits.length === 10) out = `+1${digits}`;
    else if (digits.length === 11 && digits.startsWith("1")) out = `+${digits}`;
    else return "";
  } else {
    digits = digits.replace(/^0+/, "");
    out = `+${country}${digits}`;
  }
  return /^\+[1-9]\d{7,14}$/.test(out) ? out : "";
}

export function phone(raw: unknown): string {
  const p = e164(raw);
  if (!p) throw new UserError("Enter a phone number, with its country code if it's not local");
  return p;
}

/** Tags typed as "VIP, newsletter" as a clean, lower-case, de-duplicated list. */
export function tags(v: unknown): string[] {
  const list = Array.isArray(v) ? v : String(v ?? "").split(/[,;]/);
  return [...new Set(list.map((t) => String(t).trim().toLowerCase().slice(0, 40)).filter(Boolean))].slice(0, 20);
}

const STOP_WORDS = new Set(["stop", "stopall", "unsubscribe", "cancel", "end", "quit", "optout", "revoke"]);
const START_WORDS = new Set(["start", "yes", "unstop", "optin"]);

/** What an incoming text asks for: to stop texts, to start them again, or nothing. */
export function optKeyword(body: string): "stop" | "start" | null {
  const word = body.toLowerCase().replace(/[^a-z]/g, "");
  if (STOP_WORDS.has(word)) return "stop";
  if (START_WORDS.has(word)) return "start";
  return null;
}

/** One CSV line split into fields, honouring double quotes. */
export function csvFields(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quoted) {
      if (ch === '"' && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else cur += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") {
      out.push(cur);
      cur = "";
    } else cur += ch;
  }
  out.push(cur);
  return out.map((f) => f.trim());
}
