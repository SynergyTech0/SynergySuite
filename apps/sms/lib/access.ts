type Env = Record<string, string | undefined>;

/**
 * Who may use SMS: SMS_ALLOWED_EMAILS, else the suite's ADMIN_EMAILS. Texts cost money, so with
 * neither set nobody can.
 */
export function members(env: Env = process.env): string[] {
  const raw = env.SMS_ALLOWED_EMAILS?.trim() ? env.SMS_ALLOWED_EMAILS : (env.ADMIN_EMAILS ?? "");
  return raw
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

export function canUseSms(email: string, env: Env = process.env): boolean {
  return members(env).includes(email.trim().toLowerCase());
}
