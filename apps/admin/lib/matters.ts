import { record } from "./audit";
import { can } from "./access";
import { suiteApps } from "./apps";
import { q, tx, type Tq } from "./db";
import { listExports } from "./exports";
import { touchPolicy } from "./policy";
import { listForMatter } from "./searches";
import type { HoldRecord, Matter, MatterDetail, Me } from "./types";
import { ForbiddenError, UserError, emailList, required, text, uuid } from "./util";

/**
 * Matters (eDiscovery cases) and their legal holds. Admins see every matter; an eDiscovery
 * manager sees the ones they own or are a member of. Matters are closed, never deleted, and a
 * released hold keeps its record.
 */

type MatterRow = {
  id: string; name: string; description: string; status: "open" | "closed"; owner: string; members: string[];
  created_by: string; created_at: Date; closed_by: string | null; closed_at: Date | null; active_holds: number; custodians: number;
};

const MCOLS = `m.id, m.name, m.description, m.status, m.owner, m.members, m.created_by, m.created_at, m.closed_by, m.closed_at,
  (SELECT count(*)::int FROM holds h WHERE h.matter_id = m.id AND h.active) AS active_holds,
  (SELECT count(DISTINCT c)::int FROM holds h, jsonb_array_elements_text(h.custodians) c WHERE h.matter_id = m.id AND h.active) AS custodians`;

const iso = (d: Date | null) => (d ? d.toISOString() : null);

function toMatter(r: MatterRow): Matter {
  return {
    id: r.id, name: r.name, description: r.description, status: r.status, owner: r.owner, members: r.members,
    createdBy: r.created_by, createdAt: r.created_at.toISOString(), closedBy: r.closed_by, closedAt: iso(r.closed_at),
    activeHolds: r.active_holds, custodians: r.custodians,
  };
}

/** SQL limiting matters to the ones this person may see, with its parameter. */
function visibleTo(me: Me, first: number): { sql: string; params: unknown[] } {
  if (can(me.role, "matters.all")) return { sql: "TRUE", params: [] };
  return { sql: `(m.owner = $${first} OR m.members ? $${first})`, params: [me.email] };
}

export function canSee(me: Me, m: { owner: string; members: string[] }): boolean {
  return can(me.role, "matters.all") || m.owner === me.email || m.members.includes(me.email);
}

export async function list(me: Me, status?: string): Promise<Matter[]> {
  const v = visibleTo(me, 1);
  const params = [...v.params];
  let where = v.sql;
  if (status === "open" || status === "closed") {
    params.push(status);
    where += ` AND m.status = $${params.length}`;
  }
  const rows = await q<MatterRow>(`SELECT ${MCOLS} FROM matters m WHERE ${where} ORDER BY m.status = 'open' DESC, m.created_at DESC`, params);
  return rows.map(toMatter);
}

async function row(id: string, tq: Tq = q): Promise<MatterRow> {
  const [r] = await tq<MatterRow>(`SELECT ${MCOLS} FROM matters m WHERE m.id = $1`, [uuid(id, "That matter")]);
  if (!r) throw new UserError("That matter was not found", 404);
  return r;
}

/** The matter if this person may see it; otherwise a 404, so its existence isn't revealed. */
export async function get(me: Me, id: string, tq: Tq = q): Promise<Matter> {
  const r = await row(id, tq);
  if (!canSee(me, r)) throw new UserError("That matter was not found", 404);
  return toMatter(r);
}

export async function detail(me: Me, id: string): Promise<MatterDetail> {
  const m = await get(me, id);
  const [holds, searches, exports] = await Promise.all([holdsFor(m.id), listForMatter(m.id), listExports(m.id)]);
  return { ...m, holds, searches, exports };
}

export type MatterInput = { name?: unknown; description?: unknown; owner?: unknown; members?: unknown };

export async function create(me: Me, v: MatterInput): Promise<Matter> {
  const name = required(v.name, "A name", 200);
  const description = text(v.description, 4000);
  const members = emailList(v.members ?? [], 100).filter((e) => e !== me.email);
  return tx(async (tq) => {
    const [r] = await tq<{ id: string }>(
      `INSERT INTO matters (name, description, owner, members, created_by) VALUES ($1, $2, $3, $4, $3) RETURNING id`,
      [name, description, me.email, JSON.stringify(members)],
    );
    await record(me.email, "matter.create", r.id, { name, members }, tq);
    return get(me, r.id, tq);
  });
}

/** Rename, describe, change members or owner, close or reopen. */
export async function update(me: Me, id: string, v: MatterInput & { status?: unknown }): Promise<Matter> {
  return tx(async (tq) => {
    const cur = await get(me, id, tq);
    const sets: string[] = [];
    const params: unknown[] = [cur.id];
    const changes: Record<string, unknown> = {};
    const set = (col: string, val: unknown, key: string, show: unknown = val) => {
      params.push(val);
      sets.push(`${col} = $${params.length}`);
      changes[key] = show;
    };
    if (v.name !== undefined) set("name", required(v.name, "A name", 200), "name");
    if (v.description !== undefined) set("description", text(v.description, 4000), "description");
    if (v.owner !== undefined) {
      const owner = emailList([v.owner], 1)[0];
      if (!owner) throw new UserError("A matter needs an owner");
      if (owner !== cur.owner && cur.owner !== me.email && !can(me.role, "matters.all")) throw new ForbiddenError("Only the owner or an admin can hand the matter over");
      set("owner", owner, "owner");
    }
    if (v.members !== undefined) {
      const members = emailList(v.members, 100);
      set("members", JSON.stringify(members), "members", members);
    }
    if (v.status !== undefined && v.status !== cur.status) {
      if (v.status !== "open" && v.status !== "closed") throw new UserError("Unknown status");
      set("status", v.status, "status");
      if (v.status === "closed") {
        params.push(me.email);
        sets.push(`closed_by = $${params.length}`, "closed_at = now()");
      } else {
        sets.push("closed_by = NULL", "closed_at = NULL");
      }
      // A closed matter's holds stop applying (and apply again if it reopens).
      if (cur.activeHolds) await tq(touchPolicy);
    }
    if (!sets.length) return cur;
    await tq(`UPDATE matters SET ${sets.join(", ")}, updated_at = now() WHERE id = $1`, params);
    const action = changes.status === "closed" ? "matter.close" : changes.status === "open" ? "matter.reopen" : "matter.update";
    await record(me.email, action, cur.id, { name: cur.name, ...changes, ...(changes.status === "closed" && cur.activeHolds ? { holdsLifted: cur.activeHolds } : {}) }, tq);
    return get(me, cur.id, tq);
  });
}

// ----- holds -----

type HoldRow = {
  id: string; matter_id: string; matter_name: string; matter_status: "open" | "closed"; name: string; custodians: string[]; apps: string[];
  active: boolean; created_by: string; created_at: Date; released_by: string | null; released_at: Date | null;
};

const HCOLS = `h.id, h.matter_id, m.name AS matter_name, m.status AS matter_status, h.name, h.custodians, h.apps, h.active,
  h.created_by, h.created_at, h.released_by, h.released_at`;

function toHold(r: HoldRow): HoldRecord {
  return {
    id: r.id, matterId: r.matter_id, matterName: r.matter_name, matterStatus: r.matter_status, name: r.name,
    custodians: r.custodians, apps: r.apps, active: r.active, createdBy: r.created_by, createdAt: r.created_at.toISOString(),
    releasedBy: r.released_by, releasedAt: iso(r.released_at),
  };
}

export async function holdsFor(matterId: string): Promise<HoldRecord[]> {
  const rows = await q<HoldRow>(`SELECT ${HCOLS} FROM holds h JOIN matters m ON m.id = h.matter_id WHERE h.matter_id = $1 ORDER BY h.active DESC, h.created_at DESC`, [matterId]);
  return rows.map(toHold);
}

/** Every hold this person may see, newest first. */
export async function allHolds(me: Me, opts: { status?: string; custodian?: string } = {}): Promise<HoldRecord[]> {
  const v = visibleTo(me, 1);
  const params = [...v.params];
  let where = v.sql;
  if (opts.status === "active") where += " AND h.active";
  if (opts.status === "released") where += " AND NOT h.active";
  const who = text(opts.custodian, 254).toLowerCase();
  if (who) {
    params.push(who);
    where += ` AND h.custodians ? $${params.length}`;
  }
  const rows = await q<HoldRow>(`SELECT ${HCOLS} FROM holds h JOIN matters m ON m.id = h.matter_id WHERE ${where} ORDER BY h.active DESC, h.created_at DESC LIMIT 1000`, params);
  return rows.map(toHold);
}

async function holdRow(me: Me, id: string, tq: Tq): Promise<HoldRow> {
  const [r] = await tq<HoldRow & { owner: string; members: string[] }>(
    `SELECT ${HCOLS}, m.owner, m.members FROM holds h JOIN matters m ON m.id = h.matter_id WHERE h.id = $1 FOR UPDATE OF h`,
    [uuid(id, "That hold")],
  );
  if (!r || !canSee(me, r)) throw new UserError("That hold was not found", 404);
  return r;
}

/** Apps a hold covers: [] means every app. Only registry ids are kept. */
export function cleanApps(v: unknown): string[] {
  if (v === undefined || v === null || v === "" || v === "all") return [];
  if (!Array.isArray(v)) throw new UserError("Pick the apps the hold covers");
  const known = new Set(suiteApps().map((a) => a.id));
  const out = [...new Set(v.map((x) => text(x, 40)))];
  for (const id of out) if (!known.has(id)) throw new UserError(`Unknown app "${id.slice(0, 40)}"`);
  return out.sort();
}

export type HoldInput = { name?: unknown; custodians?: unknown; apps?: unknown };

export async function createHold(me: Me, matterId: string, v: HoldInput): Promise<HoldRecord> {
  return tx(async (tq) => {
    const m = await get(me, matterId, tq);
    if (m.status !== "open") throw new UserError("Reopen the matter to place a hold");
    const custodians = emailList(v.custodians, 1000);
    if (!custodians.length) throw new UserError("Add at least one custodian");
    const apps = cleanApps(v.apps);
    const name = text(v.name, 200) || `${m.name} hold`;
    const [r] = await tq<{ id: string }>(
      `INSERT INTO holds (matter_id, name, custodians, apps, created_by) VALUES ($1, $2, $3, $4, $5) RETURNING id`,
      [m.id, name, JSON.stringify(custodians), JSON.stringify(apps), me.email],
    );
    await tq(touchPolicy);
    await record(me.email, "hold.create", r.id, { matter: m.id, matterName: m.name, name, custodians, apps: apps.length ? apps : "all" }, tq);
    return toHold(await holdRow(me, r.id, tq));
  });
}

/** Changes an active hold's name, custodians or apps; the audit log keeps what it was. */
export async function updateHold(me: Me, id: string, v: HoldInput): Promise<HoldRecord> {
  return tx(async (tq) => {
    const cur = await holdRow(me, id, tq);
    if (!cur.active) throw new UserError("A released hold can't be changed; place a new one");
    const name = v.name !== undefined ? required(v.name, "A name", 200) : cur.name;
    const custodians = v.custodians !== undefined ? emailList(v.custodians, 1000) : cur.custodians;
    if (!custodians.length) throw new UserError("A hold needs at least one custodian; release it instead");
    const apps = v.apps !== undefined ? cleanApps(v.apps) : cur.apps;
    await tq(`UPDATE holds SET name = $2, custodians = $3, apps = $4, updated_at = now() WHERE id = $1`, [cur.id, name, JSON.stringify(custodians), JSON.stringify(apps)]);
    await tq(touchPolicy);
    const added = custodians.filter((c) => !cur.custodians.includes(c));
    const removed = cur.custodians.filter((c) => !custodians.includes(c));
    await record(me.email, "hold.update", cur.id, {
      matter: cur.matter_id, name, added, removed,
      apps: { before: cur.apps.length ? cur.apps : "all", after: apps.length ? apps : "all" },
    }, tq);
    return toHold(await holdRow(me, cur.id, tq));
  });
}

export async function releaseHold(me: Me, id: string): Promise<HoldRecord> {
  return tx(async (tq) => {
    const cur = await holdRow(me, id, tq);
    if (!cur.active) return toHold(cur);
    await tq(`UPDATE holds SET active = false, released_by = $2, released_at = now(), updated_at = now() WHERE id = $1`, [cur.id, me.email]);
    await tq(touchPolicy);
    await record(me.email, "hold.release", cur.id, { matter: cur.matter_id, name: cur.name, custodians: cur.custodians }, tq);
    return toHold(await holdRow(me, cur.id, tq));
  });
}

/** Counts for the home page. */
export async function counts(): Promise<{ openMatters: number; activeHolds: number; custodiansOnHold: number }> {
  const [r] = await q<{ open_matters: number; active_holds: number; custodians: number }>(
    `SELECT (SELECT count(*)::int FROM matters WHERE status = 'open') AS open_matters,
            (SELECT count(*)::int FROM holds h JOIN matters m ON m.id = h.matter_id WHERE h.active AND m.status = 'open') AS active_holds,
            (SELECT count(DISTINCT c)::int FROM holds h JOIN matters m ON m.id = h.matter_id, jsonb_array_elements_text(h.custodians) c
              WHERE h.active AND m.status = 'open') AS custodians`,
  );
  return { openMatters: r.open_matters, activeHolds: r.active_holds, custodiansOnHold: r.custodians };
}
