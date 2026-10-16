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
