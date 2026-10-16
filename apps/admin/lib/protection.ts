import {
  allTypes, BUILT_IN_TYPES, DLP_TEMPLATES, evaluateDlp, patternProblem, validateLabels,
  type CustomInfoType, type DlpAction, type DlpDecision, type DlpIncident, type DlpRule, type DlpSettings,
  type LabelSettings, type SensitivityLabel,
} from "@synergy/compliance";
import { record } from "./audit";
import { suiteApps } from "./apps";
import { q, tx } from "./db";
import { touchPolicy } from "./policy";
import type { Me } from "./types";
import { text, UserError, uuid } from "./util";

/**
 * Information protection: the suite's sensitivity labels and its data loss prevention rules,
 * custom sensitive information types and the incidents apps report. Every change notes the
 * policy as changed, so apps pick it up with their next policy fetch (about a minute).
 */

// ---------- labels ----------

type LabelRow = { id: string; name: string; color: string; description: string; priority: number; block_external: boolean; marking: string; updated_by: string; updated_at: Date };

export const toLabel = (r: LabelRow): SensitivityLabel => ({
  id: r.id, name: r.name, color: r.color, priority: r.priority,
  ...(r.description ? { description: r.description } : {}),
  protection: { blockExternal: r.block_external, ...(r.marking ? { marking: r.marking } : {}) },
});

export async function labelSettings(): Promise<LabelSettings> {
  const [rows, [s]] = await Promise.all([
    q<LabelRow>(`SELECT * FROM labels ORDER BY priority, lower(name)`),
    q<{ default_label_id: string | null }>(`SELECT default_label_id FROM label_settings WHERE id = 1`),
  ]);
  const labels = rows.map(toLabel);
  const def = s?.default_label_id && labels.some((l) => l.id === s.default_label_id) ? s.default_label_id : undefined;
  return { labels, ...(def ? { defaultLabelId: def } : {}) };
}

export function cleanLabel(v: Record<string, unknown>): Omit<SensitivityLabel, "id" | "priority"> {
  const name = text(v.name, 60);
  if (!name) throw new UserError("Give the label a name");
  const color = text(v.color, 7);
  if (!/^#[0-9a-f]{6}$/i.test(color)) throw new UserError("Pick a color");
  const p = (v.protection ?? {}) as Record<string, unknown>;
  const marking = text(p.marking, 80);
  return {
    name, color: color.toLowerCase(),
    ...(text(v.description, 300) ? { description: text(v.description, 300) } : {}),
    protection: { blockExternal: p.blockExternal === true, ...(marking ? { marking } : {}) },
  };
}

export async function createLabel(me: Me, v: Record<string, unknown>): Promise<SensitivityLabel> {
  const l = cleanLabel(v);
  return tx(async (tq) => {
    const [row] = await tq<LabelRow>(
      `INSERT INTO labels (name, color, description, priority, block_external, marking, updated_by)
       VALUES ($1, $2, $3, (SELECT coalesce(max(priority) + 1, 0) FROM labels), $4, $5, $6) RETURNING *`,
      [l.name, l.color, l.description ?? "", l.protection.blockExternal, l.protection.marking ?? "", me.email],
    );
    await tq(touchPolicy);
    await record(me.email, "label.create", row.id, { name: l.name, blockExternal: l.protection.blockExternal }, tq);
    return toLabel(row);
  });
}

export async function updateLabel(me: Me, id: string, v: Record<string, unknown>): Promise<SensitivityLabel> {
  const l = cleanLabel(v);
  return tx(async (tq) => {
    const [before] = await tq<LabelRow>(`SELECT * FROM labels WHERE id = $1`, [uuid(id, "That label")]);
    if (!before) throw new UserError("That label was not found", 404);
    const [row] = await tq<LabelRow>(
      `UPDATE labels SET name = $2, color = $3, description = $4, block_external = $5, marking = $6, updated_by = $7, updated_at = now()
        WHERE id = $1 RETURNING *`,
      [before.id, l.name, l.color, l.description ?? "", l.protection.blockExternal, l.protection.marking ?? "", me.email],
    );
    await tq(touchPolicy);
    const changed = Object.fromEntries(
      ([["name", before.name, row.name], ["color", before.color, row.color], ["description", before.description, row.description], ["blockExternal", before.block_external, row.block_external], ["marking", before.marking, row.marking]] as const)
        .filter(([, a, b]) => a !== b).map(([k, a, b]) => [k, { from: a, to: b }]),
    );
    await record(me.email, "label.update", row.id, { name: row.name, changed }, tq);
    return toLabel(row);
  });
}

export async function removeLabel(me: Me, id: string): Promise<void> {
  await tx(async (tq) => {
    const [row] = await tq<LabelRow>(`DELETE FROM labels WHERE id = $1 RETURNING *`, [uuid(id, "That label")]);
    if (!row) throw new UserError("That label was not found", 404);
    await tq(`UPDATE label_settings SET default_label_id = NULL WHERE default_label_id = $1`, [row.id]);
    await tq(touchPolicy);
    await record(me.email, "label.delete", row.id, { name: row.name }, tq);
  });
}

/** The default label and the order of the list (least sensitive first). */
export async function saveLabelSettings(me: Me, v: Record<string, unknown>): Promise<LabelSettings> {
  await tx(async (tq) => {
    const rows = await tq<LabelRow>(`SELECT * FROM labels`);
    const ids = new Set(rows.map((r) => r.id));
    const details: Record<string, unknown> = {};
    if (v.defaultLabelId !== undefined) {
      const def = v.defaultLabelId ? String(v.defaultLabelId).toLowerCase() : null;
      if (def && !ids.has(def)) throw new UserError("That label was not found", 404);
      await tq(`UPDATE label_settings SET default_label_id = $1 WHERE id = 1`, [def]);
      details.defaultLabel = def ? rows.find((r) => r.id === def)?.name : null;
    }
    if (v.order !== undefined) {
      const order = Array.isArray(v.order) ? v.order.map((x) => String(x).toLowerCase()) : [];
      if (order.length !== ids.size || new Set(order).size !== ids.size || order.some((x) => !ids.has(x))) throw new UserError("The order must list every label once");
      for (const [i, id] of order.entries()) await tq(`UPDATE labels SET priority = $2 WHERE id = $1`, [id, i]);
      details.order = order.map((id) => rows.find((r) => r.id === id)?.name);
    }
    await tq(touchPolicy);
    await record(me.email, "label.settings", "", details, tq);
  });
  return validateLabels(await labelSettings());
}

// ---------- DLP settings ----------

type RuleRow = {
  id: string; name: string; enabled: boolean; mode: "enforce" | "test"; apps: string[]; types: DlpRule["types"]; labels: string[];
  scope: "external" | "anyone"; action: DlpAction; tip: string; created_by: string; created_at: Date; updated_by: string; updated_at: Date;
};
type TypeRow = { id: string; name: string; description: string; keywords: string[]; pattern: string; created_by: string; created_at: Date };

export type RuleRecord = DlpRule & { updatedBy: string; updatedAt: string };

const toRule = (r: RuleRow): RuleRecord => ({
  id: r.id, name: r.name, enabled: r.enabled, mode: r.mode, apps: r.apps, types: r.types, labels: r.labels, scope: r.scope,
  action: r.action, tip: r.tip, updatedBy: r.updated_by, updatedAt: r.updated_at.toISOString(),
});
const toType = (r: TypeRow): CustomInfoType => ({
  id: r.id, name: r.name, ...(r.description ? { description: r.description } : {}),
  ...(r.keywords.length ? { keywords: r.keywords } : {}), ...(r.pattern ? { pattern: r.pattern } : {}),
});

/** Domains that are always internal: the suite's own mail domain. */
export function envDomains(env: NodeJS.ProcessEnv = process.env): string[] {
  return [env.MAIL_DOMAIN, env.SUITE_DOMAIN].map((d) => (d ?? "").trim().toLowerCase()).filter(Boolean).filter((d, i, a) => a.indexOf(d) === i);
}

export async function dlpSettings(): Promise<DlpSettings & { rules: RuleRecord[]; extraDomains: string[] }> {
  const [rules, types, [s]] = await Promise.all([
    q<RuleRow>(`SELECT * FROM dlp_rules ORDER BY created_at`),
    q<TypeRow>(`SELECT * FROM dlp_types ORDER BY lower(name)`),
    q<{ internal_domains: string[] }>(`SELECT internal_domains FROM dlp_settings WHERE id = 1`),
  ]);
  const extra = s?.internal_domains ?? [];
  return { rules: rules.map(toRule), types: types.map(toType), internalDomains: [...new Set([...envDomains(), ...extra])], extraDomains: extra };
}

/** What apps get in the policy feed: only rules that can match, without bookkeeping. */
export function feedDlp(s: DlpSettings): DlpSettings {
  return {
    rules: s.rules.filter((r) => r.enabled && (r.types.length || r.labels.length)).map(({ id, name, enabled, mode, apps, types, labels, scope, action, tip }) => ({ id, name, enabled, mode, apps, types, labels, scope, action, ...(tip ? { tip } : {}) })),
    types: s.types,
    internalDomains: s.internalDomains,
  };
}

export function cleanRule(v: Record<string, unknown>, known: { types: Set<string>; labels: Set<string> }): Omit<DlpRule, "id"> {
  const name = text(v.name, 100);
  if (!name) throw new UserError("Give the rule a name");
  const apps = Array.isArray(v.apps) ? [...new Set(v.apps.map((a) => String(a)))] : [];
  const appIds = new Set(suiteApps().map((a) => a.id));
  const bad = apps.find((a) => !appIds.has(a));
  if (bad) throw new UserError(`Unknown app ${bad}`);
  const types = (Array.isArray(v.types) ? v.types : []).map((t) => {
    const o = (t ?? {}) as Record<string, unknown>;
    const type = String(o.type ?? "");
    if (!known.types.has(type)) throw new UserError(`Unknown sensitive information type ${type.slice(0, 40)}`);
    const min = Number(o.min ?? 1);
    if (!Number.isInteger(min) || min < 1 || min > 10000) throw new UserError("The number of matches must be a whole number from 1 to 10000");
    return { type, min };
  });
  if (new Set(types.map((t) => t.type)).size !== types.length) throw new UserError("Each type can appear once");
  const labels = (Array.isArray(v.labels) ? [...new Set(v.labels.map((l) => String(l).toLowerCase()))] : []);
  if (labels.some((l) => !known.labels.has(l))) throw new UserError("Unknown label");
  if (!types.length && !labels.length) throw new UserError("Pick at least one kind of sensitive information or a label to look for");
  const mode = v.mode === "enforce" ? "enforce" : v.mode === "test" || v.mode === undefined ? "test" : null;
  if (!mode) throw new UserError("Mode is enforce or test");
  const scope = v.scope === "anyone" ? "anyone" : v.scope === "external" || v.scope === undefined ? "external" : null;
  if (!scope) throw new UserError("Scope is external or anyone");
  const action = (["audit", "warn", "block"] as const).find((a) => a === v.action);
  if (!action) throw new UserError("Action is audit, warn or block");
  return { name, enabled: v.enabled !== false, mode, apps: apps.sort(), types, labels, scope, action, tip: text(v.tip, 500) };
}

async function known(): Promise<{ types: Set<string>; labels: Set<string> }> {
  const [types, labels] = await Promise.all([q<{ id: string }>(`SELECT id FROM dlp_types`), q<{ id: string }>(`SELECT id FROM labels`)]);
  return { types: new Set([...BUILT_IN_TYPES.map((t) => t.id), ...types.map((t) => t.id)]), labels: new Set(labels.map((l) => l.id)) };
}

export async function createRule(me: Me, v: Record<string, unknown>): Promise<RuleRecord> {
  const r = cleanRule(v, await known());
  return tx(async (tq) => {
    const [row] = await tq<RuleRow>(
      `INSERT INTO dlp_rules (name, enabled, mode, apps, types, labels, scope, action, tip, created_by, updated_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $10) RETURNING *`,
      [r.name, r.enabled, r.mode, JSON.stringify(r.apps), JSON.stringify(r.types), JSON.stringify(r.labels), r.scope, r.action, r.tip, me.email],
    );
    await tq(touchPolicy);
    await record(me.email, "dlp.rule.create", row.id, { ...r }, tq);
    return toRule(row);
  });
}

export async function updateRule(me: Me, id: string, v: Record<string, unknown>): Promise<RuleRecord> {
  const r = cleanRule(v, await known());
  return tx(async (tq) => {
    const [row] = await tq<RuleRow>(
      `UPDATE dlp_rules SET name = $2, enabled = $3, mode = $4, apps = $5, types = $6, labels = $7, scope = $8, action = $9, tip = $10,
              updated_by = $11, updated_at = now() WHERE id = $1 RETURNING *`,
      [uuid(id, "That rule"), r.name, r.enabled, r.mode, JSON.stringify(r.apps), JSON.stringify(r.types), JSON.stringify(r.labels), r.scope, r.action, r.tip, me.email],
    );
    if (!row) throw new UserError("That rule was not found", 404);
    await tq(touchPolicy);
    await record(me.email, "dlp.rule.update", row.id, { ...r }, tq);
    return toRule(row);
  });
}

export async function removeRule(me: Me, id: string): Promise<void> {
  await tx(async (tq) => {
    const [row] = await tq<RuleRow>(`DELETE FROM dlp_rules WHERE id = $1 RETURNING *`, [uuid(id, "That rule")]);
    if (!row) throw new UserError("That rule was not found", 404);
    await tq(touchPolicy);
    await record(me.email, "dlp.rule.delete", row.id, { name: row.name }, tq);
  });
}

export function cleanType(v: Record<string, unknown>): CustomInfoType {
  const name = text(v.name, 80);
  if (!name) throw new UserError("Give the type a name");
  const keywords = [...new Set((Array.isArray(v.keywords) ? v.keywords : String(v.keywords ?? "").split(/\n|,/)).map((k) => text(k, 100)).filter(Boolean))].slice(0, 200);
  const pattern = text(v.pattern, 500);
  if (!keywords.length && !pattern) throw new UserError("Give keywords or a pattern");
  const problem = pattern ? patternProblem(pattern) : null;
  if (problem) throw new UserError(problem);
  const id = `custom-${name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "type"}`;
  return { id, name, ...(text(v.description, 300) ? { description: text(v.description, 300) } : {}), ...(keywords.length ? { keywords } : {}), ...(pattern ? { pattern } : {}) };
}

export async function createType(me: Me, v: Record<string, unknown>): Promise<CustomInfoType> {
  const t = cleanType(v);
  return tx(async (tq) => {
    const [row] = await tq<TypeRow>(
      `INSERT INTO dlp_types (id, name, description, keywords, pattern, created_by) VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [t.id, t.name, t.description ?? "", JSON.stringify(t.keywords ?? []), t.pattern ?? "", me.email],
    );
    await tq(touchPolicy);
    await record(me.email, "dlp.type.create", row.id, { name: t.name, keywords: t.keywords?.length ?? 0, pattern: t.pattern ?? "" }, tq);
    return toType(row);
  });
}

export async function removeType(me: Me, id: string): Promise<void> {
  await tx(async (tq) => {
    const using = await tq<{ name: string }>(`SELECT name FROM dlp_rules WHERE types @> $1::jsonb`, [JSON.stringify([{ type: id }])]);
    if (using.length) throw new UserError(`Used by ${using.map((r) => `"${r.name}"`).join(", ")}; take it out of those rules first`, 409);
    const [row] = await tq<TypeRow>(`DELETE FROM dlp_types WHERE id = $1 RETURNING *`, [id]);
    if (!row) throw new UserError("That type was not found", 404);
    await tq(touchPolicy);
    await record(me.email, "dlp.type.delete", row.id, { name: row.name }, tq);
  });
}

export function cleanDomains(v: unknown): string[] {
  const raw = Array.isArray(v) ? v : String(v ?? "").split(/[\s,;]+/);
  const out = new Set<string>();
  for (const item of raw) {
    const d = text(item, 253).toLowerCase().replace(/^@/, "");
    if (!d) continue;
    if (!/^(?=.{1,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$/.test(d)) throw new UserError(`"${d.slice(0, 60)}" is not a domain`);
    out.add(d);
  }
  return [...out].sort();
}

export async function saveDomains(me: Me, v: unknown): Promise<string[]> {
  const domains = cleanDomains(v);
  await tx(async (tq) => {
    await tq(`UPDATE dlp_settings SET internal_domains = $1 WHERE id = 1`, [JSON.stringify(domains)]);
    await tq(touchPolicy);
    await record(me.email, "dlp.domains", "", { domains }, tq);
  });
  return domains;
}

/** Tries the current rules on pasted text, as if an app checked it. */
export async function testDlp(v: Record<string, unknown>): Promise<DlpDecision> {
  const s = await dlpSettings();
  const recipients = String(v.recipients ?? "").split(/[\s,;]+/).map((r) => r.trim()).filter(Boolean).slice(0, 200);
  return evaluateDlp(feedDlp(s), {
    app: text(v.app, 40) || "mail",
    text: String(v.text ?? "").slice(0, 200_000),
    labelId: text(v.labelId, 40) || null,
    recipients,
    ...(v.external === true ? { external: true } : {}),
  });
}

export function templates() {
  return DLP_TEMPLATES;
}

export { allTypes };

// ---------- incidents ----------

type IncidentRow = {
  id: string; at: Date; app: string; actor: string; title: string; target: string; action: DlpAction; overridden: boolean; justification: string;
  rules: DlpIncident["rules"]; matches: DlpIncident["matches"]; recipients: string[]; label_id: string | null;
  status: "open" | "resolved" | "dismissed"; note: string; resolved_by: string | null; resolved_at: Date | null;
};
export type IncidentRecord = Omit<IncidentRow, "at" | "resolved_at" | "label_id" | "resolved_by"> & { at: string; labelId: string | null; resolvedBy: string | null; resolvedAt: string | null };

const toIncident = (r: IncidentRow): IncidentRecord => {
  const { at, resolved_at, label_id, resolved_by, ...rest } = r;
  return { ...rest, at: at.toISOString(), labelId: label_id, resolvedBy: resolved_by, resolvedAt: resolved_at?.toISOString() ?? null };
};

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** An incident as an app sent it, checked and trimmed; the app comes from the body and must be a suite app. */
export function cleanIncident(v: Record<string, unknown>): DlpIncident {
  const app = text(v.app, 40);
  if (!suiteApps().some((a) => a.id === app)) throw new UserError("Unknown app");
  const actor = text(v.actor, 254).toLowerCase();
  if (!EMAIL.test(actor)) throw new UserError("actor must be an email");
  const action = (["audit", "warn", "block"] as const).find((a) => a === v.action);
  if (!action) throw new UserError("action is audit, warn or block");
  const list = <T,>(x: unknown, max: number, f: (o: Record<string, unknown>) => T | null): T[] =>
    (Array.isArray(x) ? x : []).slice(0, max).map((o) => f((o ?? {}) as Record<string, unknown>)).filter((o): o is T => o !== null);
  return {
    app, actor, action,
    title: text(v.title, 300),
    ...(text(v.target, 200) ? { target: text(v.target, 200) } : {}),
    overridden: v.overridden === true && action === "warn",
    ...(text(v.justification, 1000) ? { justification: text(v.justification, 1000) } : {}),
    rules: list(v.rules, 50, (o) => (text(o.id, 60) ? { id: text(o.id, 60), name: text(o.name, 100), action: (["audit", "warn", "block"] as const).find((a) => a === o.action) ?? "audit", mode: o.mode === "test" ? "test" : "enforce" } : null)),
    matches: list(v.matches, 50, (o) => (text(o.type, 60) ? { type: text(o.type, 60), name: text(o.name, 100), count: Math.max(0, Math.floor(Number(o.count) || 0)) } : null)),
    recipients: (Array.isArray(v.recipients) ? v.recipients : []).slice(0, 500).map((r) => text(r, 254).toLowerCase()).filter((r) => EMAIL.test(r)),
    labelId: text(v.labelId, 40) || null,
  };
}

export async function addIncident(v: Record<string, unknown>): Promise<{ id: string }> {
  const i = cleanIncident(v);
  const [row] = await q<{ id: string }>(
    `INSERT INTO dlp_incidents (app, actor, title, target, action, overridden, justification, rules, matches, recipients, label_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING id::text`,
    [i.app, i.actor, i.title, i.target ?? "", i.action, i.overridden ?? false, i.justification ?? "", JSON.stringify(i.rules), JSON.stringify(i.matches), JSON.stringify(i.recipients ?? []), i.labelId ?? null],
  );
  return row;
}

export type IncidentFilter = { status?: string; app?: string; action?: string; q?: string; before?: string; limit?: number };

export async function listIncidents(f: IncidentFilter = {}): Promise<{ incidents: IncidentRecord[]; more: boolean; open: number }> {
  const where: string[] = [];
  const params: unknown[] = [];
  const add = (sql: (p: string) => string, v: unknown) => {
    params.push(v);
    where.push(sql(`$${params.length}`));
  };
  if (f.status && ["open", "resolved", "dismissed"].includes(f.status)) add((p) => `status = ${p}`, f.status);
  if (f.app) add((p) => `app = ${p}`, text(f.app, 40));
  if (f.action && ["audit", "warn", "block"].includes(f.action)) add((p) => `action = ${p}`, f.action);
  const s = text(f.q, 200);
  if (s) add((p) => `(actor ILIKE ${p} OR title ILIKE ${p} OR recipients::text ILIKE ${p})`, `%${s.replace(/[\\%_]/g, (c) => `\\${c}`)}%`);
  if (/^\d+$/.test(f.before ?? "")) add((p) => `id < ${p}::bigint`, f.before);
  const limit = Math.min(Math.max(f.limit ?? 100, 1), 500);
  const [rows, [open]] = await Promise.all([
    q<IncidentRow>(`SELECT * FROM dlp_incidents ${where.length ? `WHERE ${where.join(" AND ")}` : ""} ORDER BY id DESC LIMIT ${limit + 1}`, params),
    q<{ n: number }>(`SELECT count(*)::int AS n FROM dlp_incidents WHERE status = 'open'`),
  ]);
  return { incidents: rows.slice(0, limit).map(toIncident), more: rows.length > limit, open: open?.n ?? 0 };
}

export async function updateIncident(me: Me, id: string, v: Record<string, unknown>): Promise<IncidentRecord> {
  if (!/^\d+$/.test(id)) throw new UserError("That alert was not found", 404);
  const status = (["open", "resolved", "dismissed"] as const).find((s) => s === v.status);
  if (!status) throw new UserError("Status is open, resolved or dismissed");
  return tx(async (tq) => {
    const [row] = await tq<IncidentRow>(
      `UPDATE dlp_incidents SET status = $2, note = $3,
              resolved_by = CASE WHEN $2 = 'open' THEN NULL ELSE $4 END,
              resolved_at = CASE WHEN $2 = 'open' THEN NULL ELSE now() END
        WHERE id = $1::bigint RETURNING *`,
      [id, status, text(v.note, 1000), me.email],
    );
    if (!row) throw new UserError("That alert was not found", 404);
    await record(me.email, `dlp.alert.${status === "open" ? "reopen" : status}`, row.id, { app: row.app, actor: row.actor, title: row.title }, tq);
    return toIncident(row);
  });
}
