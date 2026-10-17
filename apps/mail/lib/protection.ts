import {
  type DlpAction, type DlpDecision, type DlpIncident, type DlpMatch, type SensitivityLabel, isInternal, msipHeader,
} from "@synergy/compliance";
import { stripHtml } from "./maildoc";

/**
 * Sensitivity labels and data loss prevention on outgoing mail. The rules and labels come from the
 * Admin center (policy.ts); this is what Mail does with them when someone sends: the pure parts,
 * so the send route only wires them up.
 */

const escapeHtml = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

/** The bare address of "Name <a@b>" or "a@b". */
export const addressOf = (r: string) => r.replace(/^.*<([^>]+)>\s*$/, "$1").trim().toLowerCase();

/** Attachments whose text is worth scanning; pictures, PDFs and archives are skipped. */
export function isTextAttachment(contentType: string | undefined, filename = ""): boolean {
  const t = (contentType || "").toLowerCase();
  if (t) return t.startsWith("text/") || t.includes("json") || t.includes("csv");
  return /\.(txt|csv|json|md|log)$/i.test(filename);
}

/** Everything that would leave, as text for the DLP check: subject, body and text attachments. */
export function outgoingText(m: {
  subject: string; text?: string; html?: string;
  attachments?: { filename: string; contentType?: string; content: Buffer }[];
}): string {
  const body = m.text?.trim() ? m.text : m.html ? stripHtml(m.html) : "";
  const files = (m.attachments ?? []).filter((a) => isTextAttachment(a.contentType, a.filename)).map((a) => a.content.toString("utf8"));
  return [m.subject, body, ...files].filter(Boolean).join("\n");
}

/** What the composer is told when DLP stops a message. */
export type DlpRefusal = {
  error: string;
  dlp: { action: "warn" | "block"; tip: string; matches: DlpMatch[]; outside: string[] };
};

export type DlpOutcome =
  | { send: true; overridden: boolean; justification?: string }
  | { send: false; status: 409 | 422; body: DlpRefusal };

/**
 * Whether a message goes out, given the DLP decision: block never (422); warn only with a reason
 * from the sender (409 until then); audit and allow always.
 */
export function dlpOutcome(d: DlpDecision, override?: { justification?: unknown } | null): DlpOutcome {
  if (d.action === "allow" || d.action === "audit") return { send: true, overridden: false };
  const justification = typeof override?.justification === "string" ? override.justification.trim() : "";
  if (d.action === "warn" && justification) return { send: true, overridden: true, justification };
  const tip = d.tip ?? "This message contains sensitive information.";
  return {
    send: false,
    status: d.action === "block" ? 422 : 409,
    body: { error: tip, dlp: { action: d.action, tip, matches: d.matches, outside: d.outside } },
  };
}

/** The incident the Admin center records when a rule matched; null when none did. */
export function dlpIncident(
  d: DlpDecision, o: DlpOutcome, m: { actor: string; title: string; recipients: string[]; labelId: string | null },
): Omit<DlpIncident, "app"> | null {
  if (!d.rules.length || d.action === "allow") return null;
  return {
    actor: m.actor.toLowerCase(),
    title: m.title,
    action: d.action as DlpAction,
    overridden: o.send && o.overridden,
    ...(o.send && o.justification ? { justification: o.justification } : {}),
    rules: d.rules,
    matches: d.matches.map(({ type, name, count }) => ({ type, name, count })),
    recipients: m.recipients,
    labelId: m.labelId,
  };
}

/** Recipients a label keeps the message from going to: everyone outside, when it blocks external sharing. */
export function blockedRecipients(label: SensitivityLabel | null, recipients: string[], internalDomains: string[]): string[] {
  if (!label?.protection.blockExternal) return [];
  return [...new Set(recipients.map(addressOf))].filter((r) => !isInternal(r, internalDomains));
}

/**
 * The label on an outgoing message: the msip_labels header Outlook writes, and the label's
 * marking as a last line of the text and HTML bodies. No label, no header.
 */
export function applyLabel<T extends { text?: string; html?: string }>(m: T, label: SensitivityLabel | null): T & { headers: Record<string, string> } {
  if (!label) return { ...m, headers: {} };
  const marking = label.protection.marking?.trim();
  return {
    ...m,
    headers: { msip_labels: msipHeader(label) },
    ...(marking && m.text !== undefined ? { text: `${m.text.replace(/\s+$/, "")}\n\n${marking}` } : {}),
    ...(marking && m.html !== undefined
      ? { html: `${m.html}<p style="color:#6b7280;font-size:12px;font-weight:600">${escapeHtml(marking)}</p>` }
      : {}),
  };
}
