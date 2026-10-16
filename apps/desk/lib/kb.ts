import { q } from "./db";
import type { Article } from "./types";
import { text, UserError } from "./util";

// Knowledge-base articles. Staff see drafts too; the public help center only published ones.

const toArticle = (r: Record<string, unknown>): Article => ({
  id: Number(r.id),
  slug: r.slug as string,
  title: r.title as string,
  body: (r.body as string | undefined) ?? "",
  published: Boolean(r.published),
  updatedBy: (r.updated_by as string | undefined) ?? "",
  updatedAt: new Date(r.updated_at as string).toISOString(),
});

/** "How do I reset my password?" -> "how-do-i-reset-my-password" */
export function slugify(title: string): string {
  return (
    title
      .normalize("NFKD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 80)
      .replace(/-+$/, "") || "article"
  );
}

export async function list(): Promise<Article[]> {
  return (await q("SELECT * FROM kb_articles ORDER BY lower(title), id")).map(toArticle);
}

export async function get(id: number): Promise<Article> {
  const [r] = await q("SELECT * FROM kb_articles WHERE id = $1", [id]);
  if (!r) throw new UserError("That article doesn't exist", 404);
  return toArticle(r);
}

/** Picks a free slug: "billing", then "billing-2", "billing-3"… */
async function freeSlug(title: string, except?: number): Promise<string> {
  const base = slugify(title);
  const taken = new Set(
    (await q<{ slug: string }>("SELECT slug FROM kb_articles WHERE (slug = $1 OR slug LIKE $1 || '-%') AND id IS DISTINCT FROM $2::bigint", [base, except ?? null]))
      .map((r) => r.slug),
  );
  if (!taken.has(base)) return base;
  for (let n = 2; ; n++) if (!taken.has(`${base}-${n}`)) return `${base}-${n}`;
}

type Input = { title?: unknown; body?: unknown; published?: unknown };

export async function create(me: string, input: Input): Promise<Article> {
  const title = text(input.title, 200);
  if (!title) throw new UserError("Give the article a title");
  const [r] = await q(
    "INSERT INTO kb_articles (slug, title, body, published, updated_by) VALUES ($1,$2,$3,$4,$5) RETURNING *",
    [await freeSlug(title), title, text(input.body, 100000), Boolean(input.published), me],
  );
  return toArticle(r);
}

/** The slug stays put once an article exists, so links people saved keep working. */
export async function update(me: string, id: number, input: Input): Promise<Article> {
  const title = input.title == null ? null : text(input.title, 200);
  if (title === "") throw new UserError("Give the article a title");
  const [r] = await q(
    `UPDATE kb_articles SET title = COALESCE($2, title), body = COALESCE($3, body),
       published = COALESCE($4, published), updated_by = $5, updated_at = now()
     WHERE id = $1 RETURNING *`,
    [id, title, input.body == null ? null : text(input.body, 100000), input.published == null ? null : Boolean(input.published), me],
  );
  if (!r) throw new UserError("That article doesn't exist", 404);
  return toArticle(r);
}

export async function remove(id: number): Promise<void> {
  await q("DELETE FROM kb_articles WHERE id = $1", [id]);
}

// ---------- public ----------

export async function published(): Promise<Article[]> {
  return (await q("SELECT * FROM kb_articles WHERE published ORDER BY lower(title), id")).map(toArticle);
}

export async function publishedBySlug(slug: string): Promise<Article | null> {
  const [r] = await q("SELECT * FROM kb_articles WHERE published AND slug = $1", [slug]);
  return r ? toArticle(r) : null;
}
