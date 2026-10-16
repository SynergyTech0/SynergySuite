/**
 * Company admins run the home page (quick links, company announcements) and can moderate every
 * community. They come from ENGAGE_ADMIN_EMAILS, else the suite's ADMIN_EMAILS. With neither set,
 * a development install treats DEV_USER_EMAIL as one, so the home page can be tried locally.
 */
export function companyAdmins(env: NodeJS.ProcessEnv = process.env): string[] {
  const list = (env.ENGAGE_ADMIN_EMAILS || env.ADMIN_EMAILS || "")
    .split(/[\s,;]+/)
    .map((e) => e.trim().toLowerCase())
    .filter((e) => e.includes("@"));
  if (list.length) return list;
  const dev = (env.DEV_USER_EMAIL || env.DEV_EMAIL || "").trim().toLowerCase();
  return dev && env.NODE_ENV !== "production" ? [dev] : [];
}

export function isCompanyAdmin(email: string, env: NodeJS.ProcessEnv = process.env): boolean {
  return companyAdmins(env).includes(email.toLowerCase());
}

/** The company's name on the home page (ENGAGE_COMPANY_NAME), else the product's. */
export function companyName(env: NodeJS.ProcessEnv = process.env): string {
  return (env.ENGAGE_COMPANY_NAME || "").trim() || "Synergy";
}
