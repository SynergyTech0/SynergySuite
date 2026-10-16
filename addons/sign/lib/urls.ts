/** Sign's own public address, for links in email and sign-in round trips. */
export function publicBase(env: NodeJS.ProcessEnv = process.env): string {
  const base =
    env.SIGN_PUBLIC_URL ||
    (env.SUITE_DOMAIN ? `https://sign.${env.SUITE_DOMAIN}` : "") ||
    `http://localhost:${env.PORT || 3300}`;
  return base.replace(/\/$/, "");
}
