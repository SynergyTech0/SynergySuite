import { NextResponse } from "next/server";
import { headers } from "next/headers";
import { cameThroughGateway } from "@synergy/identity";
import { appUrl } from "@synergy/config";
import { q, tx } from "./db";
import { fail } from "./api";
import { type Role, UserError, cleanEmail, cleanName, isRole, maxRole } from "./names";

/**
 * Calls from the other suite servers (Groups). They reach this app on the internal network
 * with PROXY_SHARED_SECRET, which only the gateway and suite servers hold; the gateway itself
 * never forwards /api/svc/ (see deploy/Caddyfile), so a browser can't get here.
 */
export async function fromSuiteServer(): Promise<boolean> {
  const h = await headers();
  const secret = process.env.PROXY_SHARED_SECRET;
  if (!secret) return process.env.NODE_ENV !== "production";
  return cameThroughGateway(h, secret);
}

/** Wraps a /api/svc/ route: anyone without the secret gets the same 404 as a missing page. */
export function svcRoute<A extends unknown[]>(fn: (req: Request, ...rest: A) => Promise<Response | unknown>) {
  return async (req: Request, ...rest: A): Promise<Response> => {
    try {
      if (!(await fromSuiteServer())) return NextResponse.json({ error: "Not found" }, { status: 404 });
      const out = await fn(req, ...rest);
      return out instanceof Response ? out : NextResponse.json(out ?? { ok: true });
    } catch (err) {
      return fail(err);
    }
  };
}

/* ---------------------------------------------------------- team libraries */

const SOURCE = /^groups:[0-9a-f-]{36}$/;

/** A source key as Groups sends it ("groups:<group id>"); anything else is refused. */
export function source(raw: unknown): string {
  let s = String(raw ?? "");
  try {
    s = decodeURIComponent(s);
  } catch {
    // left as it came; the pattern below refuses it
  }
  if (!SOURCE.test(s)) throw new UserError("Bad source");
  return s;
}

export type TeamMember = { email: string; role: Role };

/** The member list, emails cleaned and anyone listed twice kept once with their best role. */
function memberList(raw: unknown): TeamMember[] {
  if (!Array.isArray(raw)) throw new UserError("members must be a list");
  const best = new Map<string, Role>();
  for (const m of raw as { email?: unknown; role?: unknown }[]) {
    const email = cleanEmail(m?.email);
    if (!isRole(m?.role)) throw new UserError(`Bad role for ${email}`);
    best.set(email, maxRole(best.get(email), m.role) ?? m.role);
  }
  return [...best].map(([email, role]) => ({ email, role }));
}

const libraryUrl = (id: string) => `${appUrl("drive")}/?library=${id}`;

/**
 * Makes the team's library exactly what Groups says: created on first call, then renamed and
 * its members replaced on every later one. Files are never touched.
 */
export async function putTeamLibrary(rawSource: unknown, b: { name?: unknown; description?: unknown; members?: unknown }): Promise<{ id: string; url: string }> {
  const src = source(rawSource);
  const name = cleanName(String(b.name ?? ""));
  const description = b.description === undefined || b.description === null ? null : String(b.description).slice(0, 500);
  const members = memberList(b.members);
  const id = await tx(async (tq) => {
    const [l] = await tq<{ id: string }>(
      `INSERT INTO libraries (name, description, created_by, source) VALUES ($1, COALESCE($2, ''), $3, $3)
       ON CONFLICT (source) WHERE source IS NOT NULL
       DO UPDATE SET name = EXCLUDED.name, description = COALESCE($2, libraries.description)
       RETURNING id`,
      [name, description, src],
    );
    await tq("DELETE FROM library_members WHERE library_id = $1 AND email <> ALL($2)", [l.id, members.map((m) => m.email)]);
    for (const m of members) {
      await tq(
        `INSERT INTO library_members (library_id, email, role) VALUES ($1, $2, $3)
         ON CONFLICT (library_id, email) DO UPDATE SET role = EXCLUDED.role`,
        [l.id, m.email, m.role],
      );
    }
    return l.id;
  });
  return { id, url: libraryUrl(id) };
}

async function teamLibrary(rawSource: unknown): Promise<string | null> {
  const [l] = await q<{ id: string }>("SELECT id FROM libraries WHERE source = $1", [source(rawSource)]);
  return l?.id ?? null;
}

export type TeamItem = {
  id: string; name: string; kind: "file" | "folder"; mime: string; size: number; modifiedAt: string; modifiedBy: string; url: string;
};

/** The library's most recently changed files and folders, out of the recycle bin and not held-deleted. */
export async function teamRecent(rawSource: unknown, rawLimit: unknown): Promise<TeamItem[]> {
  const lib = await teamLibrary(rawSource);
  if (!lib) throw new UserError("Not found", 404);
  const limit = Math.min(50, Math.max(1, Math.floor(Number(rawLimit)) || 8));
  const rows = await q<{ id: string; name: string; kind: "file" | "folder"; mime: string; size: string; modified_at: Date; modified_by: string; parent_id: string | null }>(
    `SELECT id, name, kind, mime, size, modified_at, modified_by, parent_id FROM items
     WHERE library_id = $1 AND trash_root IS NULL AND held_deleted_at IS NULL
     ORDER BY modified_at DESC LIMIT $2`,
    [lib, limit],
  );
  const base = appUrl("drive");
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    kind: r.kind,
    mime: r.mime,
    size: Number(r.size),
    modifiedAt: r.modified_at.toISOString(),
    modifiedBy: r.modified_by,
    // A folder opens in place; a file opens its folder with the file in preview.
    url:
      r.kind === "folder"
        ? `${base}/?parent=${r.id}`
        : `${base}/?${r.parent_id ? `parent=${r.parent_id}` : `library=${lib}`}&preview=${r.id}`,
  }));
}

/**
 * The team is gone: everyone loses access, the files stay (and with them any legal hold).
 * The library keeps its source, so the team coming back gets the same files again.
 */
export async function dropTeamLibrary(rawSource: unknown): Promise<void> {
  const lib = await teamLibrary(rawSource);
  if (lib) await q("DELETE FROM library_members WHERE library_id = $1", [lib]);
}
