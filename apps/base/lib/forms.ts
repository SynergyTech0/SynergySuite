/**
 * Forms: a table's records one at a time, as in Access's Form view, laid out by lib/formLayout.ts.
 * A form can also be published to Synergy Forms as a public online form; its responses are then
 * brought into the table as new records when someone asks for them ("Get responses").
 */
import { canEdit, getDatabase, getTable, newId, relationsTo, type DatabaseInfo, type Role, type TableRef } from "./catalog";
import { db, ready } from "./db";
import { cleanName, FieldValueError, type Field } from "./fields";
import { cleanLayout, defaultLayout, onlineQuestions, type FormLayout } from "./formLayout";
import { forbidden, HttpError, notFound } from "./http";
import { insertRows } from "./rows";
import { createOnlineForm, onlineSubmissions, publicUrl, updateOnlineForm } from "./synergyForms";

/** The link to Synergy Forms as stored: question i (Synergy Forms' "f<i>") fills fields[i]. */
type OnlineLink = { formId: string; slug: string; fields: string[]; published: boolean; lastSubmission: string | null; syncedAt: string | null; syncing?: string };

export type FormInfo = {
  id: string;
  databaseId: string;
  tableId: string;
  name: string;
  layout: FormLayout;
  online: { url: string; published: boolean; fields: string[]; syncedAt: string | null } | null;
  position: number;
  updatedAt: string;
};

function formRow(r: any): FormInfo {
  const o = r.online as OnlineLink | null;
  return {
    id: r.id,
    databaseId: r.database_id,
    tableId: r.table_id,
    name: r.name,
    layout: cleanLayout(r.layout),
    online: o ? { url: publicUrl(o.slug), published: o.published, fields: o.fields, syncedAt: o.syncedAt } : null,
    position: r.position,
    updatedAt: new Date(r.updated_at).toISOString(),
  };
}

async function member(databaseId: string, email: string): Promise<DatabaseInfo> {
  const info = await getDatabase(databaseId, email);
  if (!info) throw notFound();
  return info;
}

export async function listForms(databaseId: string, email: string): Promise<FormInfo[]> {
  await member(databaseId, email);
  const { rows } = await db().q(`SELECT * FROM base_forms WHERE database_id = $1 ORDER BY position, lower(name)`, [databaseId]);
  return rows.map(formRow);
}

async function loadForm(id: string, email: string): Promise<{ form: FormInfo; link: OnlineLink | null; role: Role }> {
  await ready();
  const { rows } = await db().q(
    `SELECT f.*, m.role FROM base_forms f JOIN base_members m ON m.database_id = f.database_id AND m.email = $2 WHERE f.id = $1`,
    [id, email],
  );
  if (!rows[0]) throw notFound();
  return { form: formRow(rows[0]), link: rows[0].online, role: rows[0].role };
}

export async function getForm(id: string, email: string): Promise<FormInfo> {
  return (await loadForm(id, email)).form;
}

/** The layout, keeping only fields of the table and subforms of tables that look it up. */
async function checkedLayout(t: TableRef, input: unknown): Promise<FormLayout> {
  const layout = cleanLayout(input);
  const relations = await relationsTo(t.id);
  layout.items = layout.items.filter((i) => t.fields.some((f) => f.id === i.field));
  layout.subforms = layout.subforms.filter((s) => relations.some((r) => r.tableId === s.table && r.fieldId === s.field));
  return layout;
}

async function checkName(databaseId: string, name: string, except?: string) {
  const { rows } = await db().q(`SELECT 1 FROM base_forms WHERE database_id = $1 AND lower(name) = lower($2) AND id <> $3`, [databaseId, name, except ?? ""]);
  if (rows[0]) throw new FieldValueError(`There's already a form called ${name}`);
}

/** A new form on a table, laid out as Access's Form button would unless a layout is sent. */
export async function createForm(databaseId: string, email: string, input: { name?: unknown; tableId?: unknown; layout?: unknown }): Promise<FormInfo> {
  const info = await member(databaseId, email);
  if (!canEdit(info.role)) throw forbidden();
  const t = await getTable(String(input.tableId ?? ""), email);
  if (t.databaseId !== databaseId) throw notFound();
  const name = cleanName(input.name ?? t.name, "Form name");
  await checkName(databaseId, name);
  const layout = input.layout === undefined ? defaultLayout(t.fields, await relationsTo(t.id)) : await checkedLayout(t, input.layout);
  const { rows } = await db().q(
    `INSERT INTO base_forms (id, database_id, table_id, name, layout, position)
     VALUES ($1, $2, $3, $4, $5, (SELECT coalesce(max(position) + 1, 0) FROM base_forms WHERE database_id = $2)) RETURNING *`,
    [newId(), databaseId, t.id, name, layout],
  );
  return formRow(rows[0]);
}

export async function updateForm(id: string, email: string, input: { name?: unknown; layout?: unknown; position?: unknown }): Promise<FormInfo> {
  const { form, role } = await loadForm(id, email);
  if (!canEdit(role)) throw forbidden();
  const name = input.name === undefined ? form.name : cleanName(input.name, "Form name");
  if (name.toLowerCase() !== form.name.toLowerCase()) await checkName(form.databaseId, name, id);
  const layout = input.layout === undefined ? form.layout : await checkedLayout(await getTable(form.tableId, email), input.layout);
  const position = Number.isInteger(input.position) ? (input.position as number) : form.position;
  const { rows } = await db().q(`UPDATE base_forms SET name = $2, layout = $3, position = $4, updated_at = now() WHERE id = $1 RETURNING *`, [id, name, layout, position]);
  return formRow(rows[0]);
}

/** Deletes the form; an online form linked to it stops taking responses. */
export async function deleteForm(id: string, email: string): Promise<void> {
  const { link, role } = await loadForm(id, email);
  if (!canEdit(role)) throw forbidden();
  await db().q(`DELETE FROM base_forms WHERE id = $1`, [id]);
  if (link?.published) await updateOnlineForm(email, link.formId, { published: false }).catch(() => {});
}

/**
 * Publishes the form to Synergy Forms, or updates the online form already linked to it with the
 * current fields. Responses already in under the old questions are brought in first, so none are
 * read against the wrong fields.
 */
export async function publishForm(id: string, email: string): Promise<{ form: FormInfo; notes: string[]; added: number }> {
  const { form, link, role } = await loadForm(id, email);
  if (!canEdit(role)) throw forbidden();
  const t = await getTable(form.tableId, email);
  const { questions, fieldIds, notes } = onlineQuestions(form.layout, t.fields);
  if (!questions.length) throw new HttpError(400, "None of this form's fields can be asked online; add text, number, date, choice, email or Yes/No fields");
  const title = form.layout.title ?? form.name;
  let added = 0;
  let next: OnlineLink | null = null;
  if (link) {
    const synced = await syncResponses(id, email).catch((e) => {
      // Deleted in Synergy Forms: a new online form is made below.
      if ((e as HttpError).status === 404) return null;
      throw e;
    });
    if (synced) {
      added = synced.added;
      notes.push(...synced.failed.map((f) => `Response ${f.submission} wasn't added: ${f.reason}`));
      const updated = await updateOnlineForm(email, link.formId, { title, questions, published: true });
      if (updated) {
        const { link: now } = await loadForm(id, email);
        next = { ...(now ?? link), fields: fieldIds, published: true, slug: updated.slug };
      }
    }
  }
  if (!next) {
    const made = await createOnlineForm(email, { title, questions });
    next = { formId: made.id, slug: made.slug, fields: fieldIds, published: true, lastSubmission: null, syncedAt: null };
  }
  delete next.syncing;
  const { rows } = await db().q(`UPDATE base_forms SET online = $2, updated_at = now() WHERE id = $1 RETURNING *`, [id, next]);
  return { form: formRow(rows[0]), notes, added };
}

/** Stops the online form taking responses; it stays linked, so publishing again reopens it. */
export async function unpublishForm(id: string, email: string): Promise<FormInfo> {
  const { link, role } = await loadForm(id, email);
  if (!canEdit(role)) throw forbidden();
  if (!link) throw new HttpError(400, "This form isn't online");
  await updateOnlineForm(email, link.formId, { published: false });
  const { rows } = await db().q(`UPDATE base_forms SET online = online || '{"published": false}'::jsonb, updated_at = now() WHERE id = $1 RETURNING *`, [id]);
  return formRow(rows[0]);
}

/** What a response's answer becomes for a field: Synergy Forms sends text, and "yes" for a ticked box. */
function answer(f: Field, raw: string | undefined): unknown {
  if (f.type === "yesno") return raw === "yes" || raw === "on" || raw === "true";
  return raw === undefined || raw.trim() === "" ? null : raw;
}

function reason(e: unknown): string {
  if (e instanceof FieldValueError) return e.message;
  const err = e as { code?: string; status?: number; message?: string };
  if (err.code === "23502") return "a required field is empty";
  if (err.code === "23505") return "a value is already used in a field that doesn't allow duplicates";
  if (err.code === "23503") return "a related record doesn't exist";
  if (err.code?.startsWith("22")) return "a value doesn't fit its field";
  if (err.status && err.status < 500) return err.message ?? "it was refused";
  throw e;
}

export type SyncResult = { added: number; failed: { submission: string; submittedAt: string; reason: string }[]; missed: boolean; form: FormInfo };

/**
 * Brings responses that came in since the last time into the table as new records. A response
 * that doesn't fit (say a number field answered "lots") is skipped and listed. Only one sync per
 * form runs at a time.
 */
export async function syncResponses(id: string, email: string): Promise<SyncResult> {
  const { form, role } = await loadForm(id, email);
  if (!canEdit(role)) throw forbidden();
  // Claim the form for this sync; a claim older than two minutes was left by a sync that died.
  const { rows: claimed } = await db().q(
    `UPDATE base_forms SET online = online || jsonb_build_object('syncing', now())
      WHERE id = $1 AND online IS NOT NULL
        AND (online->>'syncing' IS NULL OR (online->>'syncing')::timestamptz < now() - interval '2 minutes')
      RETURNING online`,
    [id],
  );
  if (!claimed[0]) {
    if (!form.online) throw new HttpError(400, "This form isn't online");
    throw new HttpError(409, "Responses are already being brought in; try again in a moment");
  }
  const link = claimed[0].online as OnlineLink;
  let last = link.lastSubmission;
  const failed: SyncResult["failed"] = [];
  let added = 0;
  let missed = false;
  let ok = false;
  try {
    const subs = await onlineSubmissions(email, link.formId);
    if (subs === null) throw new HttpError(404, "The online form was deleted in Synergy Forms; publish this form again to make a new one");
    const fresh = subs.filter((s) => last === null || Number(s.id) > Number(last));
    // Synergy Forms hands over its newest 1000; if every one is new, older ones may be missing.
    missed = subs.length >= 1000 && fresh.length === subs.length;
    const t = await getTable(form.tableId, email);
    for (const s of fresh) {
      const record: Record<string, unknown> = {};
      link.fields.forEach((fieldId, i) => {
        const f = t.fields.find((x) => x.id === fieldId);
        if (f) record[f.id] = answer(f, s.data[`f${i}`]);
      });
      try {
        await insertRows(t, email, [record]);
        added++;
      } catch (e) {
        failed.push({ submission: s.id, submittedAt: s.submittedAt, reason: reason(e) });
      }
      last = s.id;
    }
    ok = true;
  } finally {
    await db().q(
      `UPDATE base_forms SET online = (online - 'syncing') || jsonb_build_object('lastSubmission', $2::text)
         || CASE WHEN $3::boolean THEN jsonb_build_object('syncedAt', now()) ELSE '{}'::jsonb END WHERE id = $1`,
      [id, last, ok],
    );
  }
  return { added, failed, missed, form: await getForm(id, email) };
}
