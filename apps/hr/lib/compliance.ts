import { NextResponse } from "next/server";
import {
  MAX_EXPORT_IDS,
  MAX_PAGE,
  type ParsedQuery,
  type PolicyClient,
  complianceAuthorized,
  createPolicyClient,
  isEmptyQuery,
  parseQuery,
} from "@synergy/compliance";

/**
 * HR's side of the suite's compliance protocol (see packages/compliance): the Admin center's
 * eDiscovery searches and exports, and the legal holds that keep HR records from being purged.
 */
export const APP = "hr";

const g = globalThis as unknown as { __hrPolicy?: PolicyClient };

/** Holds and retention from the Admin center, one client per process. */
export function policy(): PolicyClient {
  return (g.__hrPolicy ??= createPolicyClient({ app: APP }));
}

/** Swaps the policy client, for tests. */
export function setPolicy(p: PolicyClient | undefined): void {
  g.__hrPolicy = p;
}

/** Asks about each person once per call. */
export function holdChecker(): (email: string) => Promise<boolean> {
  const seen = new Map<string, Promise<boolean>>();
  return (email) => {
    const e = email.trim().toLowerCase();
    if (!seen.has(e)) seen.set(e, policy().onHold(e));
    return seen.get(e)!;
  };
}

export class BadRequest extends Error {}

export type Search = {
  query: ParsedQuery;
  /** Lower-case emails; empty = everyone. */
  custodians: string[];
  from: Date | null;
  /** Exclusive: the day after `to` for a plain date. */
  until: Date | null;
  /** The asked-for kinds this app has; null = all of them. */
  kinds: string[] | null;
  limit: number;
  offset: number;
};

const DAY_ONLY = /^\d{4}-\d{2}-\d{2}$/;

function date(v: unknown, name: string, end: boolean): Date | null {
  if (v === undefined || v === null || v === "") return null;
  if (typeof v !== "string") throw new BadRequest(`${name} must be an ISO date`);
  const d = new Date(DAY_ONLY.test(v) ? `${v}T00:00:00Z` : v);
  if (Number.isNaN(d.getTime())) throw new BadRequest(`${name} must be an ISO date`);
  if (!end) return d;
  return new Date(d.getTime() + (DAY_ONLY.test(v) ? 86_400_000 : 1));
}

function strings(v: unknown, name: string): string[] {
  if (v === undefined || v === null) return [];
  if (!Array.isArray(v) || v.some((s) => typeof s !== "string")) throw new BadRequest(`${name} must be a list of strings`);
  return v.map((s: string) => s.trim()).filter(Boolean);
}

/** Checks a SearchRequest body. */
export function parseSearch(body: unknown, appKinds: readonly string[]): Search {
  if (!body || typeof body !== "object" || Array.isArray(body)) throw new BadRequest("Bad request body");
  const b = body as Record<string, unknown>;
  if (b.query !== undefined && b.query !== null && typeof b.query !== "string") throw new BadRequest("query must be a string");
  const asked = strings(b.kinds, "kinds");
  const limit = b.limit === undefined || b.limit === null ? 50 : Number(b.limit);
  if (!Number.isInteger(limit) || limit < 1) throw new BadRequest("limit must be a positive whole number");
  let offset = 0;
  if (b.cursor !== undefined && b.cursor !== null && b.cursor !== "") {
    const raw = typeof b.cursor === "string" ? Buffer.from(b.cursor, "base64url").toString() : "";
    if (!/^\d{1,9}$/.test(raw)) throw new BadRequest("Bad cursor");
    offset = Number(raw);
  }
  return {
    query: parseQuery(b.query as string | undefined),
    custodians: strings(b.custodians, "custodians").map((s) => s.toLowerCase()),
    from: date(b.from, "from", false),
    until: date(b.to, "to", true),
    kinds: asked.length ? appKinds.filter((k) => asked.includes(k)) : null,
    limit: Math.min(limit, MAX_PAGE),
    offset,
  };
}

/** The cursor for the page after `s`, when there is one. */
export function nextCursor(s: Search, more: boolean): string | undefined {
  return more ? Buffer.from(String(s.offset + s.limit)).toString("base64url") : undefined;
}

/** Checks an export body: `{ ids }`. */
export function parseIds(body: unknown): string[] {
  const ids = (body as { ids?: unknown } | null)?.ids;
  if (!Array.isArray(ids) || ids.some((i) => typeof i !== "string")) throw new BadRequest("ids must be a list of strings");
  if (ids.length > MAX_EXPORT_IDS) throw new BadRequest(`At most ${MAX_EXPORT_IDS} ids at a time`);
  return [...new Set(ids as string[])];
}

/** About 200 characters of plain text around the first thing the query matched. */
export function snippet(text: string | null | undefined, query: ParsedQuery): string {
  const t = (text ?? "").replace(/\s+/g, " ").trim();
  if (t.length <= 200) return t;
  const lower = t.toLowerCase();
  const at = isEmptyQuery(query)
    ? -1
    : Math.min(...query.groups.flat().map((term) => lower.indexOf(term)).filter((i) => i >= 0).concat([Infinity]));
  const start = Number.isFinite(at) && at > 80 ? at - 80 : 0;
  return `${start > 0 ? "…" : ""}${t.slice(start, start + 200)}${start + 200 < t.length ? "…" : ""}`;
}

/** Wraps a compliance route: Bearer COMPLIANCE_TOKEN only, JSON in and out, 400 on bad input. */
export function complianceRoute(fn: (body: unknown) => Promise<unknown>) {
  return async (req: Request): Promise<Response> => {
    if (!complianceAuthorized(req.headers.get("authorization"))) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ error: "Bad request body" }, { status: 400 });
    }
    try {
      return NextResponse.json(await fn(body));
    } catch (err) {
      if (err instanceof BadRequest) return NextResponse.json({ error: err.message }, { status: 400 });
      console.error(`[${APP}] compliance`, err);
      return NextResponse.json({ error: "Something went wrong" }, { status: 500 });
    }
  };
}
