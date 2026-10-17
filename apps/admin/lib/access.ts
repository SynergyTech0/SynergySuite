import { q } from "./db";

/**
 * Who may use the Admin center. Admins come from ADMIN_EMAILS; with none listed, development
 * makes the dev user an admin and production refuses everyone until it is set. Admins can make
 * other people eDiscovery managers, who use Compliance (matters, holds, search, export) only.
 */
export type Role = "admin" | "ediscovery";
export type Access = { kind: "ok"; role: Role } | { kind: "none" } | { kind: "setup" };

export const ROLE_LABEL: Record<Role, string> = { admin: "Global admin", ediscovery: "eDiscovery manager" };

export type AccessEnv = { adminEmails: string[]; production: boolean; devUser: string };

export function accessEnv(env: NodeJS.ProcessEnv = process.env): AccessEnv {
  return {
    adminEmails: (env.ADMIN_EMAILS ?? "").split(/[\s,;]+/).map((e) => e.trim().toLowerCase()).filter((e) => e.includes("@")),
    production: env.NODE_ENV === "production",
    devUser: (env.DEV_USER_EMAIL || env.DEV_EMAIL || "").trim().toLowerCase(),
  };
}

/** The decision itself, given whether the person was granted a role here. */
export function decide(email: string, env: AccessEnv, granted: Role | null): Access {
  const e = email.trim().toLowerCase();
  if (env.adminEmails.length) {
    if (env.adminEmails.includes(e)) return { kind: "ok", role: "admin" };
  } else if (env.production) {
    return { kind: "setup" };
  } else if (env.devUser && e === env.devUser) {
    return { kind: "ok", role: "admin" };
  }
  if (granted === "ediscovery") return { kind: "ok", role: "ediscovery" };
  return { kind: "none" };
}

/** Admins configured by the environment (not stored here), for the Roles page. */
export function configuredAdmins(env: AccessEnv = accessEnv()): { emails: string[]; source: "ADMIN_EMAILS" | "DEV_USER_EMAIL" | "none" } {
  if (env.adminEmails.length) return { emails: env.adminEmails, source: "ADMIN_EMAILS" };
  if (!env.production && env.devUser) return { emails: [env.devUser], source: "DEV_USER_EMAIL" };
  return { emails: [], source: "none" };
}

export async function access(email: string, env: AccessEnv = accessEnv()): Promise<Access> {
  const first = decide(email, env, null);
  if (first.kind !== "none") return first;
  const [row] = await q<{ role: Role }>(`SELECT role FROM roles WHERE email = $1`, [email.trim().toLowerCase()]);
  return decide(email, env, row?.role ?? null);
}

/** What each role may do. */
export function can(role: Role, what: "people" | "apps" | "roles" | "audit" | "retention.edit" | "protection" | "matters.all" | "compliance" | "migrate"): boolean {
  if (role === "admin") return true;
  return what === "compliance";
}
