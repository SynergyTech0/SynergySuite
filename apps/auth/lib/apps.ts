import { q, now } from './db';

/*
 * Synergy Hub app registry + per-user entitlements.
 *
 * Visibility model: an app is visible to a user if it's open_to_all (the
 * "everyone" tier) OR the user has an explicit sa_user_apps grant (restricted
 * tier — Books = finance only, Exec = execs only, MSP = Shane only). Admins see
 * everything for management, but appsForUser() reflects the real entitlement so
 * the launcher/waffle only ever show what the person is actually allowed into.
 */

export type App = {
  id: string;
  slug: string;
  name: string | null;
  description: string | null;
  url: string | null;
  icon: string | null;
  color: string | null;
  category: string | null;
  sort: string | number;
  open_to_all: string | number;
  disabled: string | number;
  suite: string | number;
};

/** The apps a given user may see/launch, ordered for display. */
export async function appsForUser(userId: string | number): Promise<App[]> {
  return q<App>(
    `SELECT * FROM sa_apps
       WHERE disabled = 0::bigint
         AND ( open_to_all = 1::bigint
               OR id IN (SELECT app_id FROM sa_user_apps WHERE user_id = $1::bigint) )
       ORDER BY sort ASC, name ASC`,
    [userId],
  );
}

/** Full catalog (admin management). */
export async function allApps(): Promise<App[]> {
  return q<App>(`SELECT * FROM sa_apps ORDER BY sort ASC, name ASC`, []);
}

/** App ids a user is explicitly granted (restricted apps only). */
export async function grantedAppIds(userId: string | number): Promise<string[]> {
  const rows = await q<{ app_id: string }>(
    `SELECT app_id FROM sa_user_apps WHERE user_id = $1::bigint`,
    [userId],
  );
  return rows.map((r) => String(r.app_id));
}

export async function grantApp(userId: string | number, appId: string | number): Promise<void> {
  const existing = await q(
    `SELECT id FROM sa_user_apps WHERE user_id = $1::bigint AND app_id = $2::bigint`,
    [userId, appId],
  );
  if (existing.length) return;
  await q(
    `INSERT INTO sa_user_apps (user_id, app_id, created_ms) VALUES ($1::bigint, $2::bigint, $3::bigint)`,
    [userId, appId, now()],
  );
}

export async function revokeApp(userId: string | number, appId: string | number): Promise<void> {
  await q(`DELETE FROM sa_user_apps WHERE user_id = $1::bigint AND app_id = $2::bigint`, [userId, appId]);
}

/** What an admin may set on a tile. Suite tiles keep their slug and address. */
export type AppInput = {
  slug?: string;
  name?: string;
  description?: string;
  url?: string;
  category?: string;
  color?: string;
  sort?: number;
  open_to_all?: boolean;
  disabled?: boolean;
};

/** A linked app: something outside the suite (another server, a vendor site) shown in the Hub. */
export async function createLinkedApp(a: AppInput & { slug: string; name: string; url: string }): Promise<string> {
  const rows = await q<{ id: string }>(
    `INSERT INTO sa_apps (slug, name, description, url, color, category, sort, open_to_all, disabled, suite, created_ms)
     VALUES ($1::text, $2::text, $3::text, $4::text, $5::text, $6::text, $7::bigint, $8::bigint, $9::bigint, 0::bigint, $10::bigint)
     RETURNING id`,
    [a.slug, a.name, a.description ?? null, a.url, a.color ?? null, a.category ?? 'Apps', a.sort ?? 500,
      a.open_to_all === false ? 0 : 1, a.disabled ? 1 : 0, now()],
  );
  return String(rows[0].id);
}

export async function updateApp(id: string | number, a: AppInput, suite: boolean): Promise<void> {
  const sets: string[] = [];
  const params: unknown[] = [id];
  const set = (col: string, cast: string, v: unknown) => {
    params.push(v);
    sets.push(`${col} = $${params.length}::${cast}`);
  };
  if (a.name !== undefined) set('name', 'text', a.name);
  if (a.description !== undefined) set('description', 'text', a.description);
  if (a.category !== undefined) set('category', 'text', a.category);
  if (a.color !== undefined) set('color', 'text', a.color || null);
  if (a.sort !== undefined) set('sort', 'bigint', a.sort);
  if (a.open_to_all !== undefined) set('open_to_all', 'bigint', a.open_to_all ? 1 : 0);
  if (a.disabled !== undefined) set('disabled', 'bigint', a.disabled ? 1 : 0);
  if (!suite && a.url !== undefined) set('url', 'text', a.url);
  if (!suite && a.slug !== undefined) set('slug', 'text', a.slug);
  if (!sets.length) return;
  await q(`UPDATE sa_apps SET ${sets.join(', ')} WHERE id = $1::bigint`, params);
}

export async function deleteApp(id: string | number): Promise<void> {
  await q(`DELETE FROM sa_user_apps WHERE app_id = $1::bigint`, [id]);
  await q(`DELETE FROM sa_apps WHERE id = $1::bigint AND suite = 0::bigint`, [id]);
}

/** Who holds an explicit grant to an app, by email. */
export async function grantees(appId: string | number): Promise<string[]> {
  const rows = await q<{ email: string }>(
    `SELECT email FROM sa_users WHERE id IN (SELECT user_id FROM sa_user_apps WHERE app_id = $1::bigint) ORDER BY email`,
    [appId],
  );
  return rows.map((r) => r.email);
}
