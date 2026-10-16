/**
 * Data loss prevention. The Admin center keeps the rules; each app that lets content leave (Mail
 * sending, Drive sharing, Chat posting) asks `evaluateDlp` before it does, with the text, the
 * content's sensitivity label and who would receive it. The answer is the strongest action of
 * the rules that matched: block, warn (the person may go ahead with a reason) or audit (allowed,
 * but the Admin center records an incident). Rules in test mode only ever audit.
 *
 * Sensitive information is found by pattern plus a check that rules out look-alikes: card
 * numbers must pass the Luhn check, IBANs the mod-97 check, routing numbers the ABA checksum,
 * and numbers that are only digits (routing numbers, unformatted SSNs, Canadian SINs) need a
 * supporting word nearby. Admins can add their own types from keywords or a regular expression.
 */

export type DlpAction = "audit" | "warn" | "block";

export interface InfoType {
  id: string;
  name: string;
  /** Built-in types are defined here; custom ones come from the Admin center. */
  builtIn?: boolean;
  description?: string;
}

/** An admin's own kind of sensitive information: any of the keywords, or the pattern. */
export interface CustomInfoType extends InfoType {
  keywords?: string[];
  /** A JavaScript regular expression, without slashes; matched case-insensitively. */
  pattern?: string;
}

export interface DlpRule {
  id: string;
  name: string;
  enabled: boolean;
  /** test: record what would have happened, never stop anyone. */
  mode: "enforce" | "test";
  /** Apps it applies to; empty = every app that checks. */
  apps: string[];
  /** Matches when at least `min` distinct values of any one of these types are found. */
  types: { type: string; min: number }[];
  /** Also matches content carrying any of these sensitivity labels. */
  labels: string[];
  /** external: only when the content would leave the organization. */
  scope: "external" | "anyone";
  action: DlpAction;
  /** What the person is told; a sensible message is used when empty. */
  tip?: string;
}

export interface DlpSettings {
  rules: DlpRule[];
  types: CustomInfoType[];
  /** Addresses at these domains (and their subdomains) are inside the organization. */
  internalDomains: string[];
}

export const EMPTY_DLP: DlpSettings = { rules: [], types: [], internalDomains: [] };

export interface DlpContext {
  app: string;
  /** Everything that would leave: subject, body, file text. */
  text?: string;
  /** The content's sensitivity label id, if it has one. */
  labelId?: string | null;
  /** Who would receive it (emails); decides `external` when that isn't given. */
  recipients?: string[];
  /** Set when the app already knows, e.g. a public link is always external. */
  external?: boolean;
}

export interface DlpMatch {
  type: string;
  name: string;
  /** Distinct values found. */
  count: number;
  /** A few values with everything but the last four characters hidden. */
  samples: string[];
}

export interface DlpDecision {
  /** allow: nothing matched. */
  action: "allow" | DlpAction;
  rules: { id: string; name: string; action: DlpAction; mode: "enforce" | "test" }[];
  matches: DlpMatch[];
  external: boolean;
  /** Recipients outside the organization. */
  outside: string[];
  /** The message to show for a warn or block. */
  tip?: string;
}

/** What apps send the Admin center whenever a rule matched. */
export interface DlpIncident {
  app: string;
  /** Who tried: lower-case email. */
  actor: string;
  /** What it was about, e.g. a subject or file name. */
  title: string;
  /** The app's id for the content, when it has one. */
  target?: string;
  action: DlpAction;
  /** warn only: the person went ahead, with this reason. */
  overridden?: boolean;
  justification?: string;
  rules: DlpDecision["rules"];
  matches: { type: string; name: string; count: number }[];
  recipients?: string[];
  labelId?: string | null;
}

// ---------- validators ----------

export function luhn(digits: string): boolean {
  let sum = 0;
  for (let i = 0; i < digits.length; i++) {
    let d = digits.charCodeAt(digits.length - 1 - i) - 48;
    if (i % 2) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
  }
  return digits.length > 0 && sum % 10 === 0;
}

export function ibanValid(raw: string): boolean {
  const s = raw.replace(/\s+/g, "").toUpperCase();
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]{11,30}$/.test(s)) return false;
  const moved = s.slice(4) + s.slice(0, 4);
  let rem = 0;
  for (const ch of moved) {
    const v = ch >= "A" ? String(ch.charCodeAt(0) - 55) : ch;
    for (const d of v) rem = (rem * 10 + (d.charCodeAt(0) - 48)) % 97;
  }
  return rem === 1;
}

export function abaValid(d: string): boolean {
  if (!/^\d{9}$/.test(d) || /^0{9}$/.test(d)) return false;
  const n = [...d].map(Number);
  return (3 * (n[0] + n[3] + n[6]) + 7 * (n[1] + n[4] + n[7]) + (n[2] + n[5] + n[8])) % 10 === 0;
}

export function ssnValid(area: string, group: string, serial: string): boolean {
  return area !== "000" && area !== "666" && area[0] !== "9" && group !== "00" && serial !== "0000";
}

const sameDigit = (d: string) => /^(\d)\1+$/.test(d);
const cardPrefix = (d: string) => /^(4|5[1-5]|2(2[2-9]|[3-6]\d|7[01]|720)|3[47]|3(0[0-5]|[68])|6(011|5|4[4-9]|22))/.test(d);

// ---------- built-in types ----------

type Finder = { re: RegExp; check?: (m: RegExpExecArray) => boolean; context?: RegExp; value?: (m: RegExpExecArray) => string };

const BUILT_IN: (InfoType & { find: Finder[] })[] = [
  {
    id: "credit-card", name: "Credit card number", builtIn: true, description: "Visa, Mastercard, Amex, Discover, Diners and JCB numbers that pass the Luhn check.",
    find: [{
      re: /\b(?:\d[ -]?){12,18}\d\b/g,
      value: (m) => m[0].replace(/[ -]/g, ""),
      check: (m) => {
        const d = m[0].replace(/[ -]/g, "");
        return d.length >= 13 && d.length <= 19 && !sameDigit(d) && cardPrefix(d) && luhn(d);
      },
    }],
  },
  {
    id: "us-ssn", name: "U.S. Social Security number", builtIn: true, description: "123-45-6789 style numbers that follow SSN rules; nine digits in a row need a word like SSN nearby.",
    find: [
      { re: /\b(\d{3})-(\d{2})-(\d{4})\b/g, check: (m) => ssnValid(m[1], m[2], m[3]), value: (m) => m[1] + m[2] + m[3] },
      { re: /\b(\d{3}) (\d{2}) (\d{4})\b/g, check: (m) => ssnValid(m[1], m[2], m[3]), context: /\b(ssn|ssns|social security|soc sec)\b/i, value: (m) => m[1] + m[2] + m[3] },
      { re: /\b(\d{3})(\d{2})(\d{4})\b/g, check: (m) => ssnValid(m[1], m[2], m[3]), context: /\b(ssn|ssns|social security|soc sec)\b/i, value: (m) => m[0] },
    ],
  },
  {
    id: "iban", name: "International bank account number (IBAN)", builtIn: true, description: "IBANs that pass the mod-97 check.",
    find: [{ re: /\b[A-Z]{2}\d{2}(?: ?[A-Z0-9]){11,30}\b/g, check: (m) => ibanValid(m[0]), value: (m) => m[0].replace(/\s+/g, "") }],
  },
  {
    id: "us-bank-routing", name: "U.S. bank routing number", builtIn: true, description: "ABA routing numbers that pass the checksum, near a word like routing or ABA.",
    find: [{ re: /\b\d{9}\b/g, check: (m) => abaValid(m[0]), context: /\b(routing|aba|rtn|transit|wire|ach)\b/i }],
  },
  {
    id: "uk-nino", name: "U.K. National Insurance number", builtIn: true,
    find: [{ re: /\b(?!BG|GB|KN|NK|NT|TN|ZZ)[A-CEGHJ-PR-TW-Z][A-CEGHJ-NPR-TW-Z] ?\d{2} ?\d{2} ?\d{2} ?[A-D]\b/g, value: (m) => m[0].replace(/ /g, "") }],
  },
  {
    id: "ca-sin", name: "Canada Social Insurance number", builtIn: true, description: "Nine-digit numbers that pass the Luhn check, near a word like SIN.",
    find: [{ re: /\b\d{3}[- ]?\d{3}[- ]?\d{3}\b/g, check: (m) => { const d = m[0].replace(/\D/g, ""); return !sameDigit(d) && luhn(d); }, context: /\b(sin|social insurance|numéro d'assurance sociale|nas)\b/i, value: (m) => m[0].replace(/\D/g, "") }],
  },
  {
    id: "credentials", name: "Passwords, keys and access tokens", builtIn: true, description: "Private keys and cloud or developer access tokens (AWS, GitHub, Stripe live, Slack, Google).",
    find: [
      { re: /-----BEGIN (?:RSA |EC |DSA |OPENSSH |ENCRYPTED |PGP )?PRIVATE KEY(?: BLOCK)?-----/g },
      { re: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g },
      { re: /\bgh[pousr]_[A-Za-z0-9]{36,}\b/g },
      { re: /\b[sr]k_live_[0-9a-zA-Z]{24,}\b/g },
      { re: /\bxox[abprs]-[0-9A-Za-z-]{10,}\b/g },
      { re: /\bAIza[0-9A-Za-z_-]{35}\b/g },
    ],
  },
];

export const BUILT_IN_TYPES: InfoType[] = BUILT_IN.map(({ find: _f, ...t }) => t);

/** The longest text scanned; anything after is ignored. */
export const MAX_SCAN_CHARS = 2_000_000;
const CONTEXT_CHARS = 120;
const MAX_SAMPLES = 3;

export const mask = (v: string) => (v.length <= 4 ? "••••" : "•••• " + v.slice(-4));

function escapeRe(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** A custom type as finders; a bad pattern finds nothing rather than breaking every check. */
function customFinders(t: CustomInfoType): Finder[] {
  const out: Finder[] = [];
  const words = (t.keywords ?? []).map((k) => k.trim()).filter(Boolean);
  if (words.length) out.push({ re: new RegExp(`(?<![\\p{L}\\p{N}])(?:${words.map(escapeRe).join("|")})(?![\\p{L}\\p{N}])`, "giu") });
  if (t.pattern) {
    try {
      out.push({ re: new RegExp(t.pattern, "gi") });
    } catch {
      /* checked when saved; ignore here */
    }
  }
  return out;
}

/** Checks a custom type's pattern; returns a message, or null when it's usable. */
export function patternProblem(pattern: string): string | null {
  try {
    const re = new RegExp(pattern, "gi");
    if (re.test("")) return "The pattern matches empty text";
    return null;
  } catch (e) {
    return `Not a valid pattern: ${(e as Error).message}`;
  }
}

/** Every type the rules can name: built-in first, then custom. */
export function allTypes(settings: Pick<DlpSettings, "types">): InfoType[] {
  return [...BUILT_IN_TYPES, ...settings.types.map(({ id, name, description }) => ({ id, name, description }))];
}

/**
 * Finds sensitive information in text. Only types named in `only` are looked for when it's given
 * (the rules' types), so a check costs no more than the rules need.
 */
export function scanText(text: string, settings: Pick<DlpSettings, "types"> = EMPTY_DLP, only?: Iterable<string>): DlpMatch[] {
  const want = only ? new Set(only) : null;
  const t = text.length > MAX_SCAN_CHARS ? text.slice(0, MAX_SCAN_CHARS) : text;
  const out: DlpMatch[] = [];
  const kinds = [...BUILT_IN, ...settings.types.map((c) => ({ id: c.id, name: c.name, find: customFinders(c) }))];
  for (const kind of kinds) {
    if (want && !want.has(kind.id)) continue;
    const found = new Set<string>();
    for (const f of kind.find) {
      const re = new RegExp(f.re.source, f.re.flags.includes("g") ? f.re.flags : f.re.flags + "g");
      for (let m; (m = re.exec(t)); ) {
        if (m[0] === "") { re.lastIndex++; continue; }
        if (f.check && !f.check(m)) continue;
        if (f.context && !f.context.test(t.slice(Math.max(0, m.index - CONTEXT_CHARS), m.index + m[0].length + CONTEXT_CHARS))) continue;
        found.add((f.value ? f.value(m) : m[0]).toLowerCase());
      }
    }
    if (found.size) out.push({ type: kind.id, name: kind.name, count: found.size, samples: [...found].slice(0, MAX_SAMPLES).map(mask) });
  }
  return out;
}

const domainOf = (email: string) => email.trim().toLowerCase().split("@").pop() ?? "";

/** Whether an address is inside the organization. With no internal domains known, nobody is. */
export function isInternal(email: string, internalDomains: string[]): boolean {
  const d = domainOf(email);
  return !!d && internalDomains.some((x) => {
    const i = x.trim().toLowerCase().replace(/^@/, "");
    return !!i && (d === i || d.endsWith("." + i));
  });
}

const RANK: Record<DlpDecision["action"], number> = { allow: 0, audit: 1, warn: 2, block: 3 };

function defaultTip(action: DlpAction, external: boolean): string {
  if (action === "block") return external ? "This contains sensitive information that can't be shared outside the company." : "This contains sensitive information that your organization doesn't allow here.";
  return external ? "This contains sensitive information and is going outside the company. Make sure that's intended." : "This contains sensitive information. Make sure it's meant to be shared.";
}

/** Decides what happens to content about to leave, given the Admin center's DLP settings. */
export function evaluateDlp(settings: DlpSettings, ctx: DlpContext): DlpDecision {
  const recipients = [...new Set((ctx.recipients ?? []).map((r) => r.trim().toLowerCase()).filter(Boolean))];
  const outside = recipients.filter((r) => !isInternal(r, settings.internalDomains));
  const external = ctx.external ?? outside.length > 0;
  const rules = settings.rules.filter((r) => r.enabled && (r.apps.length === 0 || r.apps.includes(ctx.app)) && (r.scope === "anyone" || external));
  const none: DlpDecision = { action: "allow", rules: [], matches: [], external, outside };
  if (!rules.length) return none;
  const needed = new Set(rules.flatMap((r) => r.types.map((t) => t.type)));
  const matches = needed.size && ctx.text ? scanText(ctx.text, settings, needed) : [];
  const counts = new Map(matches.map((m) => [m.type, m.count]));
  const label = ctx.labelId?.toLowerCase() ?? "";
  const hit = rules.filter((r) => r.types.some((t) => (counts.get(t.type) ?? 0) >= Math.max(1, t.min)) || (!!label && r.labels.some((l) => l.toLowerCase() === label)));
  if (!hit.length) return { ...none, matches };
  let action: DlpDecision["action"] = "allow";
  let tip: string | undefined;
  for (const r of hit) {
    const a: DlpAction = r.mode === "test" ? "audit" : r.action;
    if (RANK[a] > RANK[action]) {
      action = a;
      tip = r.mode === "test" ? undefined : r.tip?.trim() || undefined;
    }
  }
  const used = new Set(hit.flatMap((r) => r.types.map((t) => t.type)));
  return {
    action,
    rules: hit.map((r) => ({ id: r.id, name: r.name, action: r.mode === "test" ? "audit" : r.action, mode: r.mode })),
    matches: matches.filter((m) => used.has(m.type)),
    external,
    outside,
    ...(action === "warn" || action === "block" ? { tip: tip ?? defaultTip(action, external) } : {}),
  };
}

/** Starting points offered in the Admin center. */
export const DLP_TEMPLATES: Omit<DlpRule, "id">[] = [
  { name: "U.S. financial data", enabled: true, mode: "test", apps: [], types: [{ type: "credit-card", min: 1 }, { type: "us-bank-routing", min: 1 }], labels: [], scope: "external", action: "block", tip: "" },
  { name: "U.S. personal information (PII)", enabled: true, mode: "test", apps: [], types: [{ type: "us-ssn", min: 1 }], labels: [], scope: "external", action: "warn", tip: "" },
  { name: "Bank details (IBAN)", enabled: true, mode: "test", apps: [], types: [{ type: "iban", min: 1 }], labels: [], scope: "external", action: "warn", tip: "" },
  { name: "Passwords and keys anywhere", enabled: true, mode: "test", apps: [], types: [{ type: "credentials", min: 1 }], labels: [], scope: "anyone", action: "block", tip: "This looks like a password, private key or access token. Share secrets through a password manager instead." },
  { name: "Bulk customer data", enabled: true, mode: "test", apps: [], types: [{ type: "credit-card", min: 10 }, { type: "us-ssn", min: 10 }], labels: [], scope: "anyone", action: "block", tip: "" },
];
