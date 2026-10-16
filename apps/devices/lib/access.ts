/**
 * Who runs Devices. Admins (DEVICES_ADMIN_EMAILS, else the suite's ADMIN_EMAILS) see and manage
 * every device, policy and alert. Everyone else sees only their own devices and can enroll one,
 * like Intune's Company Portal. With no admins listed, development makes the dev user an admin
 * and production has none until it is set.
 */
export type Role = "admin" | "user";

export type AccessEnv = { adminEmails: string[]; production: boolean; devUser: string };

const emails = (v: string | undefined) =>
  (v ?? "").split(/[\s,;]+/).map((e) => e.trim().toLowerCase()).filter((e) => e.includes("@"));

export function accessEnv(env: NodeJS.ProcessEnv = process.env): AccessEnv {
  const own = emails(env.DEVICES_ADMIN_EMAILS);
  return {
    adminEmails: own.length ? own : emails(env.ADMIN_EMAILS),
    production: env.NODE_ENV === "production",
    devUser: (env.DEV_USER_EMAIL || env.DEV_EMAIL || "").trim().toLowerCase(),
  };
}

export function roleOf(email: string, env: AccessEnv = accessEnv()): Role {
  const e = email.trim().toLowerCase();
  if (env.adminEmails.length) return env.adminEmails.includes(e) ? "admin" : "user";
  return !env.production && env.devUser && e === env.devUser ? "admin" : "user";
}
