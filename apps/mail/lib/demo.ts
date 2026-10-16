import { UserError } from "./accounts";

type Env = Record<string, string | undefined>;

/**
 * Demo mode (DEMO_MODE=1, see deploy/README.md): a public demo instance where no mail may leave
 * the server. Mail then only sends from the suite mailbox to addresses on the suite's own mail
 * domain, and outside accounts can't be connected. The mail server refuses relaying as well.
 */
export function demoMode(env: Env = process.env): boolean {
  return env.DEMO_MODE === "1";
}

function localDomain(env: Env): string {
  return (env.MAIL_DOMAIN || env.SUITE_DOMAIN || "").toLowerCase();
}

/** Throws when demo mode is on and a message would go anywhere but this suite's own domain. */
export function checkDemoSend(accountId: string, recipients: string[], env: Env = process.env): void {
  if (!demoMode(env)) return;
  if (accountId !== "suite") throw new UserError("This is a demo: mail can only be sent from the suite mailbox", 403);
  const domain = localDomain(env);
  const outside = recipients.find((r) => {
    const address = r.replace(/^.*<([^>]+)>$/, "$1").trim().toLowerCase();
    return !domain || address.slice(address.lastIndexOf("@") + 1) !== domain;
  });
  if (outside) throw new UserError(`This is a demo: mail can only go to @${domain} addresses, not "${outside}"`, 403);
}
