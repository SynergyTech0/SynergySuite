type Env = Record<string, string | undefined>;

/**
 * Schedulers build and publish schedules and keep the roster: SHIFTS_ADMIN_EMAILS, else the
 * suite's ADMIN_EMAILS. With neither set, everyone is a scheduler.
 */
export function schedulers(env: Env = process.env): string[] {
  const raw = env.SHIFTS_ADMIN_EMAILS?.trim() ? env.SHIFTS_ADMIN_EMAILS : (env.ADMIN_EMAILS ?? "");
  return raw
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

export function isScheduler(email: string, env: Env = process.env): boolean {
  const list = schedulers(env);
  return !list.length || list.includes(email.trim().toLowerCase());
}
