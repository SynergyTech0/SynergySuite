import type { CreateSipOutboundTrunkOptions } from "livekit-server-sdk";
import { q, tx } from "./db";
import { sip } from "./livekit";
import { formatNumber, needE164 } from "./numbers";
import { UserError, cleanEmail, text } from "./util";

/**
 * SIP trunks and the numbers on them. Phone owns this list; LiveKit's SIP service is told about
 * it (an inbound trunk for the numbers, an outbound trunk for calls out, and a dispatch rule that
 * puts every call in a room of its own) whenever an admin saves, so the two never drift for long.
 */
export const INBOUND_ROOM_PREFIX = "pstn-";

export type Trunk = {
  id: string; name: string; kind: "provider" | "pbx"; address: string; transport: "udp" | "tcp" | "tls"; username: string;
  hasPassword: boolean; inboundAddresses: string[]; inboundUsername: string; hasInboundPassword: boolean;
  synced: boolean; syncedAt: string | null; syncError: string | null; numbers: NumberRow[];
};
export type NumberRow = { number: string; label: string; display: string; assignedTo: string | null; trunkId: string };

type Row = {
  id: string; name: string; kind: "provider" | "pbx"; address: string; transport: "udp" | "tcp" | "tls"; username: string; password: string;
  inbound_addresses: string[]; inbound_username: string; inbound_password: string; lk_inbound_id: string | null;
  lk_outbound_id: string | null; lk_dispatch_id: string | null; synced_at: Date | null; sync_error: string | null;
};

function view(r: Row, numbers: NumberRow[]): Trunk {
  return {
    id: r.id, name: r.name, kind: r.kind, address: r.address, transport: r.transport, username: r.username,
    hasPassword: Boolean(r.password), inboundAddresses: r.inbound_addresses, inboundUsername: r.inbound_username,
    hasInboundPassword: Boolean(r.inbound_password), synced: Boolean(r.synced_at) && !r.sync_error,
    syncedAt: r.synced_at?.toISOString() ?? null, syncError: r.sync_error, numbers: numbers.filter((n) => n.trunkId === r.id),
  };
}

export async function listNumbers(): Promise<NumberRow[]> {
  const rows = await q<{ number: string; label: string; assigned_to: string | null; trunk_id: string }>(
    "SELECT number, label, assigned_to, trunk_id FROM numbers ORDER BY number",
  );
  return rows.map((r) => ({ number: r.number, label: r.label, display: formatNumber(r.number), assignedTo: r.assigned_to, trunkId: r.trunk_id }));
}

export async function listTrunks(): Promise<Trunk[]> {
  const [rows, numbers] = await Promise.all([q<Row>("SELECT * FROM trunks ORDER BY created_at"), listNumbers()]);
  return rows.map((r) => view(r, numbers));
}

async function getRow(id: string): Promise<Row> {
  const [r] = await q<Row>("SELECT * FROM trunks WHERE id = $1", [id]);
  if (!r) throw new UserError("That trunk is gone", 404);
  return r;
}

/** host, host:port, or sip:host;transport=… — the host part only, as LiveKit wants it. */
export function cleanAddress(v: unknown): string {
  let s = text(v, 255).replace(/^sips?:/i, "").replace(/;.*$/, "").replace(/\/.*$/, "");
  if (s.includes("@")) s = s.split("@").pop()!;
  if (s && !/^[a-z0-9.-]+(:\d{1,5})?$/i.test(s) && !/^\[[0-9a-f:]+\](:\d{1,5})?$/i.test(s)) {
    throw new UserError("Enter the trunk's address as a host name or IP, like sip.example.com or 10.0.0.5:5060");
  }
  return s.toLowerCase();
}

function addresses(v: unknown): string[] {
  const list = Array.isArray(v) ? v : String(v ?? "").split(/[\s,;]+/);
  return [...new Set(list.map((a) => String(a).trim()).filter(Boolean))].map((a) => {
    if (!/^[0-9a-f.:]+(\/\d{1,3})?$/i.test(a)) throw new UserError(`"${a}" isn't an IP address or range`);
    return a;
  });
}

export type TrunkInput = Partial<{
  name: string; kind: string; address: string; transport: string; username: string; password: string;
  inboundAddresses: string[] | string; inboundUsername: string; inboundPassword: string;
}>;

function fields(v: TrunkInput, cur?: Row) {
  const name = v.name === undefined ? cur?.name ?? "" : text(v.name, 80);
  if (!name) throw new UserError("Give the trunk a name");
  const kind = v.kind === undefined ? cur?.kind ?? "provider" : v.kind === "pbx" ? "pbx" : "provider";
  const transport = v.transport === undefined ? cur?.transport ?? "udp" : (["udp", "tcp", "tls"].includes(String(v.transport)) ? v.transport : "udp");
  return {
    name, kind, transport,
    address: v.address === undefined ? cur?.address ?? "" : cleanAddress(v.address),
    username: v.username === undefined ? cur?.username ?? "" : text(v.username, 120),
    // A password left out (or sent empty) keeps the saved one; the browser never sees it.
    password: v.password ? text(v.password, 200) : cur?.password ?? "",
    inboundAddresses: v.inboundAddresses === undefined ? cur?.inbound_addresses ?? [] : addresses(v.inboundAddresses),
    inboundUsername: v.inboundUsername === undefined ? cur?.inbound_username ?? "" : text(v.inboundUsername, 120),
    inboundPassword: v.inboundPassword ? text(v.inboundPassword, 200) : cur?.inbound_password ?? "",
  };
}

export async function createTrunk(v: TrunkInput): Promise<Trunk> {
  const f = fields(v);
  const [r] = await q<{ id: string }>(
    `INSERT INTO trunks (name, kind, address, transport, username, password, inbound_addresses, inbound_username, inbound_password)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id`,
    [f.name, f.kind, f.address, f.transport, f.username, f.password, f.inboundAddresses, f.inboundUsername, f.inboundPassword],
  );
  return syncTrunk(r.id);
}

export async function updateTrunk(id: string, v: TrunkInput & { clearPassword?: boolean; clearInboundPassword?: boolean }): Promise<Trunk> {
  const cur = await getRow(id);
  const f = fields(v, cur);
  if (v.clearPassword) f.password = "";
  if (v.clearInboundPassword) f.inboundPassword = "";
  await q(
    `UPDATE trunks SET name = $2, kind = $3, address = $4, transport = $5, username = $6, password = $7,
       inbound_addresses = $8, inbound_username = $9, inbound_password = $10 WHERE id = $1`,
    [id, f.name, f.kind, f.address, f.transport, f.username, f.password, f.inboundAddresses, f.inboundUsername, f.inboundPassword],
  );
  return syncTrunk(id);
}

export async function deleteTrunk(id: string): Promise<void> {
  const r = await getRow(id);
  await removeFromLivekit(r);
  await q("DELETE FROM trunks WHERE id = $1", [id]);
}

/** Adds numbers to a trunk; each can be given to one person. */
export async function addNumbers(trunkId: string, raw: unknown): Promise<Trunk> {
  await getRow(trunkId);
  const list = (Array.isArray(raw) ? raw : String(raw ?? "").split(/[\n,;]+/)).map((s) => String(s).trim()).filter(Boolean);
  if (!list.length) throw new UserError("Enter at least one number");
  const numbers = [...new Set(list.map((n) => needE164(n)))];
  await tx(async (tq) => {
    for (const n of numbers) {
      const [taken] = await tq<{ trunk_id: string }>("SELECT trunk_id FROM numbers WHERE number = $1", [n]);
      if (taken && taken.trunk_id !== trunkId) throw new UserError(`${formatNumber(n)} is already on another trunk`, 409);
      await tq("INSERT INTO numbers (number, trunk_id) VALUES ($1, $2) ON CONFLICT (number) DO NOTHING", [n, trunkId]);
    }
  });
  return syncTrunk(trunkId);
}

export async function removeNumber(e164: string): Promise<void> {
  const [r] = await q<{ trunk_id: string }>("DELETE FROM numbers WHERE number = $1 RETURNING trunk_id", [e164]);
  if (!r) throw new UserError("That number is gone", 404);
  await syncTrunk(r.trunk_id);
}

/** Gives a number to someone (or nobody). A person has at most one number. */
export async function assignNumber(e164: string, email: unknown, label?: unknown): Promise<NumberRow> {
  const to = email ? cleanEmail(email) : null;
  const rows = await tx(async (tq) => {
    if (to) await tq("UPDATE numbers SET assigned_to = NULL WHERE assigned_to = $1 AND number <> $2", [to, e164]);
    return tq<{ number: string; label: string; assigned_to: string | null; trunk_id: string }>(
      `UPDATE numbers SET assigned_to = $2, label = COALESCE($3, label) WHERE number = $1 RETURNING number, label, assigned_to, trunk_id`,
      [e164, to, label === undefined ? null : text(label, 80)],
    );
  });
  const r = rows[0];
  if (!r) throw new UserError("That number is gone", 404);
  return { number: r.number, label: r.label, display: formatNumber(r.number), assignedTo: r.assigned_to, trunkId: r.trunk_id };
}

const TRANSPORT = { udp: 1, tcp: 2, tls: 3 } as const;

async function quietly(fn: () => Promise<unknown>): Promise<void> {
  try {
    await fn();
  } catch (e) {
    const msg = String((e as Error)?.message ?? e);
    if (!/not.?found|404|does not exist/i.test(msg)) throw e;
  }
}

async function removeFromLivekit(r: Row): Promise<void> {
  const s = sip();
  if (r.lk_dispatch_id) await quietly(() => s.deleteSipDispatchRule(r.lk_dispatch_id!));
  if (r.lk_inbound_id) await quietly(() => s.deleteSipTrunk(r.lk_inbound_id!));
  if (r.lk_outbound_id) await quietly(() => s.deleteSipTrunk(r.lk_outbound_id!));
}

/**
 * Makes LiveKit match this trunk: its old pieces are removed and new ones made, which keeps the
 * code simple and is harmless (calls already in progress aren't touched). The outcome is saved
 * on the trunk, so the admin page shows whether calls can actually get through.
 */
export async function syncTrunk(id: string): Promise<Trunk> {
  const r = await getRow(id);
  const numbers = (await q<{ number: string }>("SELECT number FROM numbers WHERE trunk_id = $1 ORDER BY number", [id])).map((n) => n.number);
  let ids: { inbound: string | null; outbound: string | null; dispatch: string | null } = { inbound: null, outbound: null, dispatch: null };
  let error: string | null = null;
  try {
    await removeFromLivekit(r);
  } catch (e) {
    // Keep pointing at the old pieces so the next save can still remove them.
    ids = { inbound: r.lk_inbound_id, outbound: r.lk_outbound_id, dispatch: r.lk_dispatch_id };
    error = String((e as Error)?.message ?? e).slice(0, 500) || "LiveKit could not be reached";
  }
  if (!error) try {
    const s = sip();
    const name = `Synergy: ${r.name}`.slice(0, 100);
    if (numbers.length) {
      const inbound = await s.createSipInboundTrunk(name, numbers, {
        allowedAddresses: r.inbound_addresses,
        ...(r.inbound_username ? { authUsername: r.inbound_username, authPassword: r.inbound_password } : {}),
        krispEnabled: true,
        metadata: JSON.stringify({ synergyTrunk: r.id }),
      });
      ids.inbound = inbound.sipTrunkId;
      const rule = await s.createSipDispatchRule(
        { type: "individual", roomPrefix: INBOUND_ROOM_PREFIX },
        { name, trunkIds: [inbound.sipTrunkId], metadata: JSON.stringify({ synergyTrunk: r.id }) },
      );
      ids.dispatch = rule.sipDispatchRuleId;
    }
    // LiveKit wants at least one number on a trunk; until one is added there is nothing to set up.
    if (r.address && numbers.length) {
      const outbound = await s.createSipOutboundTrunk(name, r.address, numbers, {
        transport: TRANSPORT[r.transport] as unknown as CreateSipOutboundTrunkOptions["transport"],
        ...(r.username ? { authUsername: r.username, authPassword: r.password } : {}),
        metadata: JSON.stringify({ synergyTrunk: r.id }),
      });
      ids.outbound = outbound.sipTrunkId;
    }
  } catch (e) {
    error = String((e as Error)?.message ?? e).slice(0, 500) || "LiveKit refused the trunk";
    console.error("[phone] trunk sync failed", r.id, error);
  }
  await q(
    `UPDATE trunks SET lk_inbound_id = $2, lk_outbound_id = $3, lk_dispatch_id = $4, synced_at = now(), sync_error = $5 WHERE id = $1`,
    [id, ids.inbound, ids.outbound, ids.dispatch, error],
  );
  const [fresh, all] = await Promise.all([getRow(id), listNumbers()]);
  return view(fresh, all);
}
