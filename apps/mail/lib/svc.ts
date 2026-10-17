import { NextResponse } from "next/server";
import { headers } from "next/headers";
import { cameThroughGateway } from "@synergy/identity";
import { UserError } from "./accounts";

/**
 * Calls from the other suite servers (Groups). They reach this app on the internal network with
 * PROXY_SHARED_SECRET, which only the gateway and suite servers hold; the gateway itself never
 * forwards /api/svc/ (see deploy/Caddyfile), so a browser can't get here.
 */
export async function fromSuiteServer(): Promise<boolean> {
  const h = await headers();
  const secret = process.env.PROXY_SHARED_SECRET;
  if (!secret) return process.env.NODE_ENV !== "production";
  return cameThroughGateway(h, secret);
}

/** Wraps a service route: 404 unless a suite server is calling, errors as JSON. */
export function svcRoute<A extends unknown[]>(fn: (req: Request, ...rest: A) => Promise<unknown>) {
  return async (req: Request, ...rest: A): Promise<Response> => {
    if (!(await fromSuiteServer())) return NextResponse.json({ error: "Not found" }, { status: 404 });
    try {
      return NextResponse.json(await fn(req, ...rest));
    } catch (err) {
      if (err instanceof UserError) return NextResponse.json({ error: err.message }, { status: err.status });
      console.error("[mail] svc", err);
      return NextResponse.json({ error: "Something went wrong" }, { status: 500 });
    }
  };
}
