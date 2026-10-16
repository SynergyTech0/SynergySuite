/**
 * contract.event delivery to the CRM (pipeline spec, "Events into the CRM").
 *
 *   POST CRM_EVENTS_URL   header x-service-token: SIGN_CRM_TOKEN
 *   { type: "contract.event", ref, at, data: { documentId, dealRef, event, signerEmail?, signerRole?, completedAt? } }
 *
 * Transactional outbox: the event is written to contract_event_outbox in the request that changed
 * the document, then delivered by a sweep — immediately (kickOutbox), by the in-process worker
 * (startOutboxWorker, started from instrumentation.ts), and on later requests. A CRM outage delays
 * events; it does not lose them. Delivery is at-least-once and the CRM dedupes on `ref`.
 *
 * Any 2xx is delivered, including the spec's 202 {unmatched:true} for an unknown dealRef (the spec
 * says not to retry those forever). Anything else retries with exponential backoff until
 * MAX_ATTEMPTS, then the row is marked failed and kept for inspection.
 *
 * Only documents with a dealRef (created by the pipeline) emit events; for every other document
 * enqueueContractEvent is a no-op.
 */
import { prisma } from "@/lib/db";

export type ContractEventName = "sent" | "signer_signed" | "completed" | "declined" | "expired";
export type ContractSignerRole = "customer" | "countersigner";

export interface ContractEventData {
  documentId: string;
  dealRef: string;
  event: ContractEventName;
  signerEmail?: string;
  signerRole?: ContractSignerRole;
  completedAt?: string;
}

export interface ContractEventBody {
  type: "contract.event";
  ref: string;
  at: string;
  data: ContractEventData;
}

export interface ContractEventInput {
  documentId: string;
  dealRef: string;
  event: ContractEventName;
  /** Part of the idempotency ref; omit for document-level events (sent/completed use their own). */
  signerId?: string;
  signerEmail?: string;
  signerRole?: ContractSignerRole;
  completedAt?: Date | string;
  at?: Date;
}

export const MAX_ATTEMPTS = Number(process.env.CONTRACT_EVENTS_MAX_ATTEMPTS || 15);
const BASE_BACKOFF_MS = 30_000;
const MAX_BACKOFF_MS = 6 * 3600_000;
/** How long a claimed row is hidden from other sweepers while one delivery is in flight. */
const LEASE_MS = 2 * 60_000;
const REQUEST_TIMEOUT_MS = 10_000;

/** sign:<documentId>:<event>:<signerId|"document"> */
export function contractEventRef(documentId: string, event: ContractEventName, signerId?: string): string {
  return `sign:${documentId}:${event}:${signerId || "document"}`;
}

/** Order 1 is the customer, everything after is Synergy's countersigner (deal contracts have two). */
export function signerRoleForOrder(order: number): ContractSignerRole {
  return order <= 1 ? "customer" : "countersigner";
}

export function buildContractEvent(i: ContractEventInput): ContractEventBody {
  const data: ContractEventData = { documentId: i.documentId, dealRef: i.dealRef, event: i.event };
  if (i.signerEmail) data.signerEmail = i.signerEmail;
  if (i.signerRole) data.signerRole = i.signerRole;
  if (i.completedAt) data.completedAt = new Date(i.completedAt).toISOString();
  return {
    type: "contract.event",
    ref: contractEventRef(i.documentId, i.event, i.signerId),
    at: (i.at ?? new Date()).toISOString(),
    data,
  };
}

/** Delay before the next try, after `attempts` failed attempts (1-based): 30s, 1m, 2m ... capped at 6h. */
export function backoffMs(attempts: number): number {
  return Math.min(BASE_BACKOFF_MS * 2 ** Math.max(0, attempts - 1), MAX_BACKOFF_MS);
}

/**
 * Record an event for delivery. Idempotent on `ref` (a replay keeps the first row). Returns
 * queued:false when the document has no dealRef. Throws only if the outbox write itself fails;
 * callers in the signing path wrap it so an event never blocks a signature.
 */
export async function enqueueContractEvent(
  i: Omit<ContractEventInput, "dealRef"> & { dealRef: string | null | undefined },
): Promise<{ queued: boolean; ref?: string }> {
  if (!i.dealRef) return { queued: false };
  const body = buildContractEvent({ ...i, dealRef: i.dealRef });
  await prisma.contractEventOutbox.upsert({
    where: { ref: body.ref },
    create: { ref: body.ref, documentId: i.documentId, payload: body as any },
    update: {},
  });
  kickOutbox();
  return { queued: true, ref: body.ref };
}

/** enqueueContractEvent that logs instead of throwing — for paths where the event is secondary. */
export async function enqueueContractEventSafe(
  i: Omit<ContractEventInput, "dealRef"> & { dealRef: string | null | undefined },
): Promise<void> {
  try {
    await enqueueContractEvent(i);
  } catch (e) {
    console.error(`[contract-events] could not record ${i.event} for ${i.documentId}:`, e);
  }
}

type OutboxRow = { id: string; ref: string; payload: unknown; attempts: number };
export type DeliveryOutcome = "delivered" | "retry" | "failed" | "skipped";

let warnedUnconfigured = false;

/** Try one row. Claims it first (lease) so two sweepers never post the same row at once. */
export async function deliverOutboxRow(row: OutboxRow, now: Date = new Date()): Promise<DeliveryOutcome> {
  const url = process.env.CRM_EVENTS_URL;
  const token = process.env.SIGN_CRM_TOKEN;
  if (!url || !token) {
    if (!warnedUnconfigured) {
      console.warn("[contract-events] CRM_EVENTS_URL / SIGN_CRM_TOKEN not set — events stay queued");
      warnedUnconfigured = true;
    }
    return "skipped"; // not an attempt: nothing was tried
  }

  const claimed = await prisma.contractEventOutbox.updateMany({
    where: { id: row.id, deliveredAt: null, failedAt: null, nextAttemptAt: { lte: now } },
    data: { nextAttemptAt: new Date(now.getTime() + LEASE_MS) },
  });
  if (claimed.count !== 1) return "skipped";

  const attempts = row.attempts + 1;
  let status: number | null = null;
  let error: string;
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json", "x-service-token": token },
      body: JSON.stringify(row.payload),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    status = res.status;
    if (res.ok) {
      await prisma.contractEventOutbox.update({
        where: { id: row.id },
        data: { deliveredAt: new Date(), attempts, lastStatus: status, lastError: null },
      });
      return "delivered";
    }
    error = `HTTP ${status}: ${(await res.text().catch(() => "")).slice(0, 300)}`;
  } catch (e) {
    error = e instanceof Error ? `${e.name}: ${e.message}` : String(e);
  }

  if (attempts >= MAX_ATTEMPTS) {
    await prisma.contractEventOutbox.update({
      where: { id: row.id },
      data: { attempts, lastStatus: status, lastError: error, failedAt: new Date() },
    });
    console.error(`[contract-events] giving up on ${row.ref} after ${attempts} attempts: ${error}`);
    return "failed";
  }
  await prisma.contractEventOutbox.update({
    where: { id: row.id },
    data: { attempts, lastStatus: status, lastError: error, nextAttemptAt: new Date(now.getTime() + backoffMs(attempts)) },
  });
  console.warn(`[contract-events] ${row.ref} attempt ${attempts} failed (${error}); will retry`);
  return "retry";
}

export async function sweepOutbox(opts: { limit?: number; now?: Date } = {}) {
  const now = opts.now ?? new Date();
  const rows = await prisma.contractEventOutbox.findMany({
    where: { deliveredAt: null, failedAt: null, nextAttemptAt: { lte: now } },
    orderBy: { createdAt: "asc" },
    take: opts.limit ?? 25,
    select: { id: true, ref: true, payload: true, attempts: true },
  });
  const tally: Record<DeliveryOutcome, number> = { delivered: 0, retry: 0, failed: 0, skipped: 0 };
  for (const row of rows) tally[await deliverOutboxRow(row, now)]++;
  return tally;
}

let inFlight: Promise<unknown> | null = null;
let again = false;

/**
 * Fire-and-forget sweep. At most one per process at a time; a kick that arrives mid-sweep (e.g. a
 * second event enqueued while the first is being posted) runs one more sweep afterwards, so the new
 * row is not left waiting for the worker interval. Errors are logged, never thrown.
 */
export function kickOutbox(): void {
  if (inFlight) { again = true; return; }
  again = false;
  inFlight = sweepOutbox()
    .catch((e) => console.error("[contract-events] sweep failed:", e))
    .finally(() => {
      inFlight = null;
      if (again) kickOutbox();
    });
}

/** Periodic sweep in this Node process. Idempotent; CONTRACT_EVENTS_WORKER=0 disables it. */
export function startOutboxWorker(intervalMs = Number(process.env.CONTRACT_EVENTS_SWEEP_MS || 30_000)): void {
  const g = globalThis as unknown as { __contractOutboxTimer?: ReturnType<typeof setInterval> };
  if (g.__contractOutboxTimer || process.env.CONTRACT_EVENTS_WORKER === "0") return;
  g.__contractOutboxTimer = setInterval(kickOutbox, intervalMs);
  (g.__contractOutboxTimer as any).unref?.();
  kickOutbox(); // drain anything left from before a restart
}
