import { cameThroughGateway } from "@synergy/identity";
import { headers } from "next/headers";

/**
 * Calls from the other suite servers (Meet, Chat). They reach this app on the internal network
 * with PROXY_SHARED_SECRET, which only the gateway and suite servers hold; the gateway itself
 * never forwards /api/svc/ (see deploy/Caddyfile), so a browser can't get here.
 */
export async function fromSuiteServer(): Promise<boolean> {
  const h = await headers();
  const secret = process.env.PROXY_SHARED_SECRET;
  if (!secret) return process.env.NODE_ENV !== "production";
  return cameThroughGateway(h, secret);
}
