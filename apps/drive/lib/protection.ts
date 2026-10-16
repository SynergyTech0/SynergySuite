import { type DlpDecision, type DlpIncident, type SensitivityLabel, isInternal } from "@synergy/compliance";

/**
 * What sharing a file is allowed to do under its sensitivity label and the Admin center's data
 * loss prevention rules. No I/O, so it is unit tested directly; lib/drive.ts gathers the facts.
 */

export type ShareKind = "link" | "people";

/** What the person sent to go ahead past a DLP warning. */
export type DlpOverride = { justification?: unknown } | null | undefined;

export type ShareOutcome =
  | { allow: true; overridden: boolean; justification?: string }
  | { allow: false; status: 409 | 422; error: string; dlp?: DlpDecision };

/**
 * Domains inside the organization. Until the Admin center lists some, the sharer's own domain
 * counts, so a label that keeps files inside doesn't stop them being shared with colleagues.
 */
export function internalDomainsFor(configured: string[], sharer: string): string[] {
  const own = sharer.trim().toLowerCase().split("@")[1];
  return configured.some((d) => d.trim()) ? configured : own ? [own] : [];
}

/** Recipients outside the organization. */
export function outsiders(recipients: string[], domains: string[]): string[] {
  return recipients.map((r) => r.trim().toLowerCase()).filter((r) => r && !isInternal(r, domains));
}

export function justificationOf(o: DlpOverride): string | undefined {
  const j = typeof o?.justification === "string" ? o.justification.trim().slice(0, 500) : "";
  return j || undefined;
}

/** The message when a label keeps content inside the organization. */
export function labelMessage(p: { name: string; kind: ShareKind; label: SensitivityLabel; own: boolean; outside: string[] }): string {
  const what = p.own ? `"${p.name}" is labeled ${p.label.name}` : `"${p.name}" holds files labeled ${p.label.name}`;
  if (p.kind === "link") return `${what}, which can't be shared outside the organization, so it can't have a view link.`;
  return `${what}, which can't be shared outside the organization (${p.outside.join(", ")}).`;
}

/**
 * The decision for one share. `blockedBy` is the label keeping it inside, on the item itself
 * (`own`) or on something inside a folder; it only matters when the share goes outside.
 * `decision` is the DLP check (null when none was needed).
 */
export function decideShare(p: {
  name: string;
  kind: ShareKind;
  external: boolean;
  outside: string[];
  blockedBy: SensitivityLabel | null;
  own: boolean;
  decision: DlpDecision | null;
  override?: DlpOverride;
}): ShareOutcome {
  if (p.external && p.blockedBy?.protection.blockExternal) {
    return { allow: false, status: 422, error: labelMessage({ name: p.name, kind: p.kind, label: p.blockedBy, own: p.own, outside: p.outside }) };
  }
  const d = p.decision;
  if (!d || d.action === "allow" || d.action === "audit") return { allow: true, overridden: false };
  const error = d.tip ?? "This contains sensitive information.";
  if (d.action === "block") return { allow: false, status: 422, error, dlp: d };
  const justification = justificationOf(p.override);
  if (!justification) return { allow: false, status: 409, error, dlp: d };
  return { allow: true, overridden: true, justification };
}

/** The Admin center's record of a DLP match, or null when nothing matched. */
export function incidentFor(p: {
  actor: string;
  name: string;
  itemId: string;
  labelId: string | null;
  recipients: string[];
  decision: DlpDecision | null;
  outcome: ShareOutcome;
}): Omit<DlpIncident, "app"> | null {
  const d = p.decision;
  if (!d || d.action === "allow") return null;
  const overridden = p.outcome.allow && p.outcome.overridden;
  return {
    actor: p.actor,
    title: p.name,
    target: p.itemId,
    action: d.action,
    ...(d.action === "warn" ? { overridden } : {}),
    ...(overridden && p.outcome.allow && p.outcome.justification ? { justification: p.outcome.justification } : {}),
    rules: d.rules,
    matches: d.matches.map(({ type, name, count }) => ({ type, name, count })),
    ...(p.recipients.length ? { recipients: p.recipients } : {}),
    labelId: p.labelId,
  };
}
