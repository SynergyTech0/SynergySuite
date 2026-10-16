import { headers } from "next/headers";
import { identify, type Identity } from "@synergy/identity";

/** The signed-in user, from the gateway's identity headers (see @synergy/identity). */
export async function currentUser(): Promise<Identity | null> {
  return identify(await headers());
}
