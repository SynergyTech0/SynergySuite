import { NextResponse } from "next/server";
import { headers } from "next/headers";
import { cameThroughGateway } from "@synergy/identity";
import { q } from "./db";
import { flatMembers, membershipsOf, owners } from "./groups";
import type { Kind } from "./types";
import { UserError, text, uuidish } from "./util";

/**
 * Groups' service API for the other suite servers (see packages/groups). They reach it on the
 * internal network with PROXY_SHARED_SECRET, which only the gateway and suite servers hold; the
 * gateway never forwards /api/svc/ (deploy/Caddyfile), so a browser can't get here.
 */
export async function fromSuiteServer(): Promise<boolean> {
  const h = await headers();
  const secret = process.env.PROXY_SHARED_SECRET;
  if (!secret) return process.env.NODE_ENV !== "production";
  return cameThroughGateway(h, secret);
}

export function svcRoute<A extends unknown[]>(fn: (req: Request, ...rest: A) => Promise<unknown>) {
  return async (req: Request, ...rest: A): Promise<Response> => {
    if (!(await fromSuiteServer())) return NextResponse.json({ error: "Not found" }, { status: 404 });
    try {
      const out = await fn(req, ...rest);
      return out instanceof Response ? out : NextResponse.json(out ?? { ok: true });
    } catch (err) {
      if (err instanceof UserError) return NextResponse.json({ error: err.message }, { status: err.status });
      console.error("[groups] svc", err);
      return NextResponse.json({ error: "Something went wrong" }, { status: 500 });
    }
  };
}

export async function memberships(email: string) {
  const e = email.trim().toLowerCase();
  if (!e.includes("@")) throw new UserError("email required");
  return { groups: await membershipsOf(e) };
}

export async function detail(id: string) {
  if (!uuidish(id)) throw new UserError("Not found", 404);
  const [g] = await q<{ id: string; kind: Kind; name: string; email: string | null; privacy: string }>(
    `SELECT id, kind, name, email, privacy FROM groups WHERE id = $1::uuid AND deleted_at IS NULL`,
    [id],
  );
  if (!g) throw new UserError("Not found", 404);
  return { ...g, email: g.email ?? "", owners: await owners(id), members: await flatMembers(id) };
}

const APP = /^[a-z][a-z0-9-]{1,30}$/;
const OURS = ["chat", "drive", "calendar", "mail"];

/** Another app (Sites) says what it made for a group, so the group's page links to it. */
export async function registerResource(id: string, b: { app?: unknown; ref?: unknown; name?: unknown; url?: unknown }) {
  if (!uuidish(id)) throw new UserError("Not found", 404);
  const app = String(b.app ?? "");
  if (!APP.test(app) || OURS.includes(app)) throw new UserError("Bad app");
  const url = text(b.url, 1000);
  if (url && !/^https?:\/\//.test(url)) throw new UserError("url must be http(s)");
  const [g] = await q(`SELECT 1 FROM groups WHERE id = $1::uuid AND deleted_at IS NULL`, [id]);
  if (!g) throw new UserError("Not found", 404);
  await q(
    `INSERT INTO resources (group_id, app, ref, name, url, status) VALUES ($1::uuid, $2, $3, $4, $5, 'ok')
     ON CONFLICT (group_id, app) DO UPDATE SET ref = EXCLUDED.ref, name = EXCLUDED.name, url = EXCLUDED.url, status = 'ok', error = '', synced_at = now()`,
    [id, app, text(b.ref, 500), text(b.name, 200), url],
  );
  return { ok: true };
}

export async function unregisterResource(id: string, app: string) {
  if (!uuidish(id) || !APP.test(app) || OURS.includes(app)) throw new UserError("Not found", 404);
  await q(`DELETE FROM resources WHERE group_id = $1::uuid AND app = $2`, [id, app]);
  return { ok: true };
}
