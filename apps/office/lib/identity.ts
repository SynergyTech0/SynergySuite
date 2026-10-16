import { headers } from "next/headers";
import { identify, optionsFromEnv } from "@synergy/identity";

export type Identity = { email: string; name: string; org: string };

// The signed-in user comes from SynergyAuth via the suite gateway (see @synergy/identity).
// DEV_EMAIL (or DEV_USER_EMAIL) lets the app run locally without the gateway.
// Pages and routes treat an empty email as signed out.
export async function identity(): Promise<Identity> {
  const who = identify(await headers(), optionsFromEnv());
  // Single company today; every doc is scoped to this org.
  const org = process.env.DOCS_ORG || "synergy";
  return { email: who?.email ?? "", name: who?.name ?? "Guest", org };
}
