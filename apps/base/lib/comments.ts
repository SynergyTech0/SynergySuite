/**
 * Comments on records, as in Microsoft Lists: anyone who can open the database reads them;
 * editors and owners add them; people delete their own, and owners delete anyone's.
 */
import { canEdit, getTable, newId, qualified } from "./catalog";
import { db } from "./db";
import { FieldValueError } from "./fields";
import { forbidden, notFound } from "./http";

export type Comment = { id: string; author: string; body: string; createdAt: string; canDelete: boolean };

export const MAX_COMMENT = 4000;

const rowId = (raw: unknown) => {
  const s = String(raw ?? "");
  if (!/^\d{1,18}$/.test(s)) throw notFound();
  return s;
};

export async function listComments(tableId: string, row: unknown, email: string): Promise<Comment[]> {
  const t = await getTable(tableId, email);
  const { rows } = await db().q(`SELECT * FROM base_comments WHERE table_id = $1 AND row_id = $2 ORDER BY created_at, id`, [t.id, rowId(row)]);
  return rows.map((r) => ({ id: r.id, author: r.author, body: r.body, createdAt: new Date(r.created_at).toISOString(), canDelete: r.author === email || t.role === "owner" }));
}

export async function addComment(tableId: string, row: unknown, email: string, body: unknown): Promise<Comment[]> {
  const t = await getTable(tableId, email);
  if (!canEdit(t.role)) throw forbidden("Only editors can comment");
  const text = typeof body === "string" ? body.trim() : "";
  if (!text) throw new FieldValueError("Write a comment first");
  if (text.length > MAX_COMMENT) throw new FieldValueError(`Comments can be up to ${MAX_COMMENT.toLocaleString("en-US")} characters`);
  const id = rowId(row);
  const { rows } = await db().q(`SELECT 1 FROM ${qualified(t)} WHERE id = $1`, [id]);
  if (!rows[0]) throw notFound();
  await db().q(`INSERT INTO base_comments (id, table_id, row_id, author, body) VALUES ($1, $2, $3, $4, $5)`, [newId(), t.id, id, email, text]);
  return listComments(tableId, id, email);
}

export async function deleteComment(id: string, email: string): Promise<void> {
  const { rows } = await db().q(`SELECT table_id, author FROM base_comments WHERE id = $1`, [id]);
  if (!rows[0]) throw notFound();
  const t = await getTable(rows[0].table_id, email);
  if (rows[0].author !== email && t.role !== "owner") throw forbidden("Only the author or an owner can delete a comment");
  await db().q(`DELETE FROM base_comments WHERE id = $1`, [id]);
}
