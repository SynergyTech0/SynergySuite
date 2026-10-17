import { customerForEmail } from "./customers";
import { q, tx } from "./db";
import { call, linked } from "./links";
import { requireDispatcher } from "./staff";
import { UserError, text } from "./util";

/**
 * Support cases from Synergy Desk (its /api/svc/tickets, Bearer DESK_API_TOKEN). A dispatcher turns a
 * case into a work order by its number; the case then gets an internal note when a technician is
 * booked, when the job is cancelled and when it is done, so the agent can tell the customer.
 */
export type DeskTicket = {
  number: string; subject: string; status: string; priority: string; requesterEmail: string; requesterName: string; firstMessage: string;
};

export function deskLinked(): boolean {
  return linked("desk");
}

function ticketNumber(v: unknown): string {
  const n = text(v, 40).toUpperCase();
  if (!/^[A-Z0-9-]{1,40}$/.test(n)) throw new UserError("Enter the case number, like T-2026-0042");
  return n;
}

export async function fetchTicket(me: string, number: unknown): Promise<DeskTicket> {
  await requireDispatcher(me);
  if (!deskLinked()) throw new UserError("Desk isn't linked: set DESK_API_TOKEN on both apps", 400);
  return call<DeskTicket>("desk", "GET", `/api/svc/tickets/${encodeURIComponent(ticketNumber(number))}`);
}

const PRIORITY: Record<string, string> = { low: "low", normal: "normal", high: "high", urgent: "urgent" };

/** A new work order from a Desk case, for the customer who raised it (made if new). */
export async function workOrderFromTicket(me: string, b: Record<string, unknown>): Promise<string> {
  const t = await fetchTicket(me, b.number);
  const [dup] = await q<{ id: string; number: string }>(
    "SELECT id, number FROM work_orders WHERE desk_ticket = $1 AND held_deleted_at IS NULL AND status <> 'cancelled' LIMIT 1",
    [t.number],
  );
  if (dup && b.again !== true) throw new UserError(`Case ${t.number} already has work order ${dup.number}`, 409);
  const customerId = await customerForEmail(me, t.requesterEmail, t.requesterName);
  const { insertWorkOrder } = await import("./workorders");
  const id = await tx((tq) =>
    insertWorkOrder(tq, me, {
      customerId, title: t.subject, description: t.firstMessage, priority: PRIORITY[t.priority] ?? "normal", deskTicket: t.number,
      kind: b.kind, skill: b.skill, estimateHours: b.estimateHours, assetId: b.assetId,
    }),
  );
  const [w] = await q<{ number: string }>("SELECT number FROM work_orders WHERE id = $1", [id]);
  await noteTicket(id, t.number, `Field service work order ${w.number} was opened for this case.`);
  return id;
}

/**
 * Leaves an internal note on the Desk case. A failure never stops the job; it shows on the work
 * order's timeline instead.
 */
export async function noteTicket(workOrderId: string, ticket: string, body: string): Promise<void> {
  if (!deskLinked()) return;
  try {
    await call("desk", "POST", `/api/svc/tickets/${encodeURIComponent(ticket)}/notes`, { body, author: "field-service" });
  } catch (e) {
    await q("INSERT INTO notes (work_order_id, author, body, event) VALUES ($1, 'field-service', $2, true)", [
      workOrderId, `Couldn't update Desk case ${ticket}: ${(e as Error).message}`.slice(0, 2000),
    ]);
  }
}
