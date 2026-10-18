type Env = Record<string, string | undefined>;

/**
 * Who may open the vault: VAULT_ALLOWED_EMAILS, else the suite's ADMIN_EMAILS. With neither set,
 * nobody can, so a fresh install never shows a shared password vault to every account.
 */
export function members(env: Env = process.env): string[] {
  const raw = env.VAULT_ALLOWED_EMAILS?.trim() ? env.VAULT_ALLOWED_EMAILS : (env.ADMIN_EMAILS ?? "");
  return raw
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

export function canUseVault(email: string, env: Env = process.env): boolean {
  return members(env).includes(email.trim().toLowerCase());
}

/** Where someone without access is told to ask: VAULT_ACCESS_CONTACT, else nobody in particular. */
export function accessContact(env: Env = process.env): string {
  return (env.VAULT_ACCESS_CONTACT ?? "").trim();
}
