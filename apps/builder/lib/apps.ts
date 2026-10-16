/**
 * Apps and who can open them. Owners do everything; editors change and publish; users run the
 * published version. People running an app also need access to its Base tables: Builder reads
 * and writes records as the person using the app, so Base's own sharing still decides.
 */
import { randomBytes } from "node:crypto";
import { holdChecker } from "./compliance";
import { db, ready } from "./db";
import { forbidden, HttpError, notFound } from "./http";
import { blankApp, checkApp, ModelError, type AppDef, type DataSource, type Layout } from "./model";

export type Role = "owner" | "editor" | "user";

export type AppSummary = {
  id: string;
  name: string;
  description: string;
  color: string;
  role: Role;
  published: boolean;
  publishedVersion: number;
  publishedAt: string | null;
  createdBy: string;
  updatedAt: string;
};

export type AppDetail = AppSummary & {
  /** The draft, for owners and editors; null for users. */
  draft: AppDef | null;
  published: boolean;
  definition: AppDef | null;
};

export type Member = { email: string; role: Role };

/** Everyone in the organization, as a member. */
export const EVERYONE = "*";

export const canEdit = (r: Role) => r === "owner" || r === "editor";

const ALPHABET = "abcdefghijklmnopqrstuvwxyz0123456789";
export function newId(): string {
  const bytes = randomBytes(12);
  let s = ALPHABET[bytes[0] % 26];
  for (let i = 1; i < 12; i++) s += ALPHABET[bytes[i] % 36];
  return s;
}

const COLOR = /^#[0-9a-f]{6}$/i;
const EMAIL = /^[^@\s]+@[^@\s]+$/;

function cleanName(v: unknown): string {
  if (typeof v !== "string" || !v.trim()) throw new HttpError(400, "An app needs a name");
  const s = v.trim().replace(/\s+/g, " ");
  if (s.length > 120) throw new HttpError(400, "That name is too long");
  return s;
}

function cleanDescription(v: unknown, fallback = ""): string {
  if (v === undefined) return fallback;
  if (typeof v !== "string") throw new HttpError(400, "The description must be text");
  return v.slice(0, 2000);
}

function definition(v: unknown): AppDef {
  try {
    return checkApp(v);
  } catch (e) {
    if (e instanceof ModelError) throw new HttpError(400, e.message);
    throw e;
  }
}

const iso = (d: unknown) => (d ? new Date(d as string).toISOString() : null);

function summary(r: any): AppSummary {
  return {
    id: r.id,
    name: r.name,
    description: r.description,
    color: r.color,
    role: r.role,
    published: r.published_version > 0,
    publishedVersion: r.published_version,
    publishedAt: iso(r.published_at),
    createdBy: r.created_by,
    updatedAt: iso(r.updated_at)!,
  };
}

/** The best role a person has on each app: their own membership or everyone's. */
const MY_ROLE = `(SELECT m.role FROM builder_members m WHERE m.app_id = a.id AND m.email IN ($1, '${EVERYONE}')
  ORDER BY CASE m.role WHEN 'owner' THEN 3 WHEN 'editor' THEN 2 ELSE 1 END DESC LIMIT 1)`;

export async function listApps(email: string): Promise<AppSummary[]> {
  await ready();
  const { rows } = await db().q(
    `SELECT a.id, a.name, a.description, a.color, a.published_version, a.published_at, a.created_by, a.updated_at, ${MY_ROLE} AS role
       FROM builder_apps a
      WHERE a.held_deleted_at IS NULL AND ${MY_ROLE} IS NOT NULL
      ORDER BY a.updated_at DESC`,
    [email],
  );
  // Users only see apps that have been published; there's nothing for them to run before that.
  return rows.map(summary).filter((a) => a.published || canEdit(a.role));
}

async function row(id: string, email: string): Promise<any> {
  await ready();
  const { rows } = await db().q(`SELECT a.*, ${MY_ROLE} AS role FROM builder_apps a WHERE a.id = $2 AND a.held_deleted_at IS NULL`, [email, id]);
  const r = rows[0];
  // Users of an app that isn't published yet get it with no definition, so the player can say so.
  if (!r || !r.role) throw notFound();
  return r;
}

export async function roleOn(id: string, email: string): Promise<Role> {
  return (await row(id, email)).role;
}

/** The app as this person may see it: editors get the draft, and everyone the published version. */
export async function getApp(id: string, email: string): Promise<AppDetail> {
  const r = await row(id, email);
  return { ...summary(r), draft: canEdit(r.role) ? r.draft : null, definition: r.published ?? null };
}

export async function createApp(email: string, input: { name?: unknown; description?: unknown; layout?: unknown; definition?: unknown; color?: unknown }): Promise<AppDetail> {
  const name = cleanName(input.name ?? "App1");
  const layout: Layout = input.layout === "phone" ? "phone" : "tablet";
  const def = input.definition === undefined ? blankApp(layout) : definition(input.definition);
  const color = typeof input.color === "string" && COLOR.test(input.color) ? input.color : "#a4373a";
  const id = newId();
  await ready();
  const c = await db().pool.connect();
  try {
    await c.query("BEGIN");
    await c.query(
      `INSERT INTO builder_apps (id, name, description, color, draft, created_by, updated_by) VALUES ($1, $2, $3, $4, $5, $6, $6)`,
      [id, name, cleanDescription(input.description), color, JSON.stringify(def), email],
    );
    await c.query(`INSERT INTO builder_members (app_id, email, role) VALUES ($1, $2, 'owner')`, [id, email]);
    await c.query("COMMIT");
  } catch (e) {
    await c.query("ROLLBACK").catch(() => {});
    throw e;
  } finally {
    c.release();
  }
  return getApp(id, email);
}

/** Saves the draft and details. Editors only. */
export async function updateApp(id: string, email: string, input: { name?: unknown; description?: unknown; color?: unknown; definition?: unknown }): Promise<AppDetail> {
  const r = await row(id, email);
  if (!canEdit(r.role)) throw forbidden();
  const name = input.name === undefined ? r.name : cleanName(input.name);
  const description = cleanDescription(input.description, r.description);
  const color = typeof input.color === "string" && COLOR.test(input.color) ? input.color : r.color;
  const def = input.definition === undefined ? r.draft : definition(input.definition);
  await db().q(
    `UPDATE builder_apps SET name = $2, description = $3, color = $4, draft = $5, updated_by = $6, updated_at = now() WHERE id = $1`,
    [id, name, description, color, JSON.stringify(def), email],
  );
  return getApp(id, email);
}

/** Makes the draft what people running the app get, as a new version. */
export async function publishApp(id: string, email: string): Promise<AppDetail> {
  const r = await row(id, email);
  if (!canEdit(r.role)) throw forbidden();
  const def = definition(r.draft);
  const c = await db().pool.connect();
  try {
    await c.query("BEGIN");
    const { rows } = await c.query(
      `UPDATE builder_apps SET published = $2, published_version = published_version + 1, published_at = now(), published_by = $3
        WHERE id = $1 RETURNING published_version`,
      [id, JSON.stringify(def), email],
    );
    await c.query(`INSERT INTO builder_versions (app_id, version, definition, published_by) VALUES ($1, $2, $3, $4)`, [id, rows[0].published_version, JSON.stringify(def), email]);
    await c.query("COMMIT");
  } catch (e) {
    await c.query("ROLLBACK").catch(() => {});
    throw e;
  } finally {
    c.release();
  }
  return getApp(id, email);
}

export async function listVersions(id: string, email: string): Promise<{ version: number; publishedBy: string; publishedAt: string }[]> {
  const r = await row(id, email);
  if (!canEdit(r.role)) throw forbidden();
  const { rows } = await db().q(`SELECT version, published_by, published_at FROM builder_versions WHERE app_id = $1 ORDER BY version DESC`, [id]);
  return rows.map((v) => ({ version: v.version, publishedBy: v.published_by, publishedAt: iso(v.published_at)! }));
}

/** Copies a published version back into the draft (publish again to make it live). */
export async function restoreVersion(id: string, email: string, version: number): Promise<AppDetail> {
  const r = await row(id, email);
  if (!canEdit(r.role)) throw forbidden();
  const { rows } = await db().q(`SELECT definition FROM builder_versions WHERE app_id = $1 AND version = $2`, [id, version]);
  if (!rows[0]) throw notFound();
  await db().q(`UPDATE builder_apps SET draft = $2, updated_by = $3, updated_at = now() WHERE id = $1`, [id, JSON.stringify(rows[0].definition), email]);
  return getApp(id, email);
}

/** Owners only. Under a legal hold on its maker, the app is hidden but kept. */
export async function deleteApp(id: string, email: string): Promise<void> {
  const r = await row(id, email);
  if (r.role !== "owner") throw forbidden("Only an owner can delete an app");
  if (await holdChecker()(r.created_by)) {
    await db().q(`UPDATE builder_apps SET held_deleted_at = now() WHERE id = $1`, [id]);
    return;
  }
  await db().q(`DELETE FROM builder_apps WHERE id = $1`, [id]);
}

// ---- Sharing ---------------------------------------------------------------------------

export async function listMembers(id: string, email: string): Promise<Member[]> {
  const r = await row(id, email);
  if (!canEdit(r.role)) throw forbidden();
  const { rows } = await db().q(`SELECT email, role FROM builder_members WHERE app_id = $1 ORDER BY CASE role WHEN 'owner' THEN 0 WHEN 'editor' THEN 1 ELSE 2 END, email`, [id]);
  return rows;
}

/** Adds or changes someone's role (`*` for everyone, who can only be users). Owners only. */
export async function setMember(id: string, email: string, input: { email?: unknown; role?: unknown }): Promise<Member[]> {
  const r = await row(id, email);
  if (r.role !== "owner") throw forbidden("Only an owner can share an app");
  const who = typeof input.email === "string" ? input.email.trim().toLowerCase() : "";
  if (who !== EVERYONE && !EMAIL.test(who)) throw new HttpError(400, "Enter an email address");
  const role = input.role;
  if (role !== "owner" && role !== "editor" && role !== "user") throw new HttpError(400, "The role must be owner, editor or user");
  if (who === EVERYONE && role !== "user") throw new HttpError(400, "Everyone in the organization can only run the app");
  if (who === email && role !== "owner") await assertAnotherOwner(id, email);
  await db().q(
    `INSERT INTO builder_members (app_id, email, role) VALUES ($1, $2, $3) ON CONFLICT (app_id, email) DO UPDATE SET role = EXCLUDED.role`,
    [id, who, role],
  );
  return listMembers(id, email);
}

export async function removeMember(id: string, email: string, who: string): Promise<Member[]> {
  const r = await row(id, email);
  const target = who.trim().toLowerCase();
  // Anyone may leave; only owners remove others.
  if (target !== email && r.role !== "owner") throw forbidden("Only an owner can change who has the app");
  const { rows } = await db().q(`SELECT role FROM builder_members WHERE app_id = $1 AND email = $2`, [id, target]);
  if (rows[0]?.role === "owner") await assertAnotherOwner(id, target);
  await db().q(`DELETE FROM builder_members WHERE app_id = $1 AND email = $2`, [id, target]);
  return target === email ? [] : listMembers(id, email);
}

async function assertAnotherOwner(id: string, leaving: string) {
  const { rows } = await db().q(`SELECT count(*)::int AS n FROM builder_members WHERE app_id = $1 AND role = 'owner' AND email <> $2`, [id, leaving]);
  if (!rows[0].n) throw new HttpError(409, "An app needs at least one owner; make someone else an owner first");
}

// ---- Data ------------------------------------------------------------------------------

/**
 * The data source an app uses for a Base table, if this person may use the app with it:
 * editors work with the draft and the published version, users with the published one.
 */
export async function dataSourceFor(id: string, email: string, tableId: string): Promise<DataSource> {
  const r = await row(id, email);
  const defs: AppDef[] = [r.published, canEdit(r.role) ? r.draft : null].filter(Boolean);
  for (const d of defs) {
    const ds = (d.dataSources ?? []).find((x: DataSource) => x.tableId === tableId);
    if (ds) return ds;
  }
  throw notFound();
}
