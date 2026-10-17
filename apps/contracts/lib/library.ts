import type { Me } from "./api";
import { TYPES, canKeepLibrary, createContract } from "./contracts";
import { q } from "./db";
import { BUILTIN_FIELDS, fillTemplate, templateClauses, templateFields } from "./template";
import { UserError, text, uuidish } from "./util";

/**
 * The template and clause library. Everyone can use it; the legal team keeps it (everyone, when
 * no legal team is set).
 */

function requireKeeper(me: Me) {
  if (!canKeepLibrary(me.email)) throw new UserError("Only the legal team can change the library", 403);
}

export type Template = { id: string; name: string; type: string; description: string; body: string; archived: boolean; modified_at: Date };
export type Clause = {
  id: string; title: string; category: string; body: string; guidance: string; fallback: string; required: boolean; archived: boolean; modified_at: Date;
};

export async function listTemplates(all = false): Promise<(Template & { fields: string[]; clauses: string[] })[]> {
  const rows = await q<Template>(
    `SELECT id, name, type, description, body, archived, modified_at FROM templates ${all ? "" : "WHERE NOT archived"} ORDER BY archived, lower(name)`,
  );
  return rows.map((t) => ({ ...t, fields: templateFields(t.body), clauses: templateClauses(t.body) }));
}

export async function saveTemplate(me: Me, id: string | null, input: Record<string, unknown>): Promise<{ id: string }> {
  requireKeeper(me);
  const name = text(input.name, 200);
  if (!name) throw new UserError("Give the template a name");
  const type = TYPES.includes(String(input.type)) ? String(input.type) : "Other";
  const params = [name, type, text(input.description, 1000), text(input.body, 400_000), input.archived === true];
  if (!id) {
    const [row] = await q<{ id: string }>(
      `INSERT INTO templates (name, type, description, body, archived, created_by) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
      [...params, me.email],
    );
    return row;
  }
  if (!uuidish(id)) throw new UserError("Not found", 404);
  const [row] = await q<{ id: string }>(
    `UPDATE templates SET name = $2, type = $3, description = $4, body = $5, archived = $6, modified_at = now() WHERE id = $1 RETURNING id`,
    [id, ...params],
  );
  if (!row) throw new UserError("Not found", 404);
  return row;
}

export async function deleteTemplate(me: Me, id: string): Promise<void> {
  requireKeeper(me);
  if (!uuidish(id)) throw new UserError("Not found", 404);
  await q(`DELETE FROM templates WHERE id = $1`, [id]);
}

export async function listClauses(all = false): Promise<Clause[]> {
  return q<Clause>(
    `SELECT id, title, category, body, guidance, fallback, required, archived, modified_at FROM clauses
     ${all ? "" : "WHERE NOT archived"} ORDER BY archived, lower(category), lower(title)`,
  );
}

export async function saveClause(me: Me, id: string | null, input: Record<string, unknown>): Promise<{ id: string }> {
  requireKeeper(me);
  const title = text(input.title, 200);
  const body = text(input.body, 50_000);
  if (!title) throw new UserError("Give the clause a title");
  if (!body) throw new UserError("Write the clause's standard text");
  const params = [title, text(input.category, 80) || "General", body, text(input.guidance, 5000), text(input.fallback, 50_000), input.required === true, input.archived === true];
  if (!id) {
    const [row] = await q<{ id: string }>(
      `INSERT INTO clauses (title, category, body, guidance, fallback, required, archived, created_by) VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
      [...params, me.email],
    );
    return row;
  }
  if (!uuidish(id)) throw new UserError("Not found", 404);
  const [row] = await q<{ id: string }>(
    `UPDATE clauses SET title = $2, category = $3, body = $4, guidance = $5, fallback = $6, required = $7, archived = $8, modified_at = now()
     WHERE id = $1 RETURNING id`,
    [id, ...params],
  );
  if (!row) throw new UserError("Not found", 404);
  return row;
}

export async function deleteClause(me: Me, id: string): Promise<void> {
  requireKeeper(me);
  if (!uuidish(id)) throw new UserError("Not found", 404);
  await q(`DELETE FROM clauses WHERE id = $1`, [id]);
}

/** Every live clause by title, for filling templates. */
export async function clauseTexts(): Promise<Record<string, string>> {
  const rows = await q<{ title: string; body: string }>(`SELECT title, body FROM clauses WHERE NOT archived`);
  return Object.fromEntries(rows.map((r) => [r.title, r.body]));
}

/**
 * A new draft from a template: the form's own fields (counterparty, dates, value) fill the
 * built-in placeholders and `values` fills the rest.
 */
export async function createFromTemplate(me: Me, templateId: string, input: Record<string, unknown>) {
  if (!uuidish(templateId)) throw new UserError("Not found", 404);
  const [t] = await q<Template>(`SELECT id, name, type, body FROM templates WHERE id = $1 AND NOT archived`, [templateId]);
  if (!t) throw new UserError("That template isn't in the library any more", 404);
  const raw = (input.values && typeof input.values === "object" ? input.values : {}) as Record<string, unknown>;
  const values: Record<string, string> = Object.fromEntries(Object.entries(raw).map(([k, v]) => [k, text(v, 2000)]));
  const builtins: Record<string, string> = {
    Counterparty: text(input.counterparty, 200),
    "Counterparty email": text(input.counterpartyEmail, 200),
    Title: text(input.title, 200) || t.name,
    "Start date": text(input.startDay, 10),
    "End date": text(input.endDay, 10),
    Value: input.value ? String(input.value) : "",
    Currency: text(input.currency, 3).toUpperCase() || "USD",
    Owner: me.name || me.email,
    Today: new Date().toISOString().slice(0, 10),
  };
  for (const k of BUILTIN_FIELDS) if (!(k in values)) values[k] = builtins[k] ?? "";
  const body = fillTemplate(t.body, values, await clauseTexts());
  return createContract(me, { ...input, title: text(input.title, 200) || t.name, type: input.type ?? t.type, body, templateId: t.id });
}
