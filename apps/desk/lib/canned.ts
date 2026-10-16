import { q } from "./db";
import type { Canned } from "./types";
import { text, UserError } from "./util";

// Canned replies are shared by all staff: one library for the whole desk.

const toCanned = (r: Record<string, unknown>): Canned => ({
  id: Number(r.id), title: r.title as string, body: r.body as string, createdBy: r.created_by as string,
});

export async function list(): Promise<Canned[]> {
  return (await q("SELECT * FROM canned_replies ORDER BY lower(title), id")).map(toCanned);
}

function clean(input: { title?: unknown; body?: unknown }) {
  const title = text(input.title, 200);
  const body = text(input.body, 20000);
  if (!title || !body) throw new UserError("Give the reply a title and some text");
  return { title, body };
}

export async function create(me: string, input: { title?: unknown; body?: unknown }): Promise<Canned> {
  const { title, body } = clean(input);
  const [r] = await q("INSERT INTO canned_replies (title, body, created_by) VALUES ($1,$2,$3) RETURNING *", [title, body, me]);
  return toCanned(r);
}

export async function update(id: number, input: { title?: unknown; body?: unknown }): Promise<Canned> {
  const { title, body } = clean(input);
  const [r] = await q("UPDATE canned_replies SET title = $2, body = $3 WHERE id = $1 RETURNING *", [id, title, body]);
  if (!r) throw new UserError("That reply doesn't exist", 404);
  return toCanned(r);
}

export async function remove(id: number): Promise<void> {
  await q("DELETE FROM canned_replies WHERE id = $1", [id]);
}
