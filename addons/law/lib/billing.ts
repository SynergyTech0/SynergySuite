import type { Me } from "./api";
import { booksConfigured, booksInvoicesUrl, createDraftInvoice } from "./books";
import { type Tq, q, tx } from "./db";
import { access, dayOrNull, logEvent, requireLead } from "./law";
import { UserError, cents, cleanEmail, minutes, text, uuidish } from "./util";

/**
 * Time and expenses on a matter, and the bills made from them. Anyone on the matter records their
 * own time; the responsible lawyer can record or fix anyone's. A bill takes every unbilled,
 * billable entry up to a day (plus a flat fee not billed yet) and, when Books is connected, becomes
 * a draft invoice there for the client. A billed entry can't change unless its bill is cancelled.
 */

export type Entry = {
  id: string; kind: "time" | "expense"; who: string; day: string; minutes: number; rate_cents: string; amount_cents: string;
  description: string; billable: boolean; bill_id: string | null; bill_number: string | null; value_cents: string;
};

const ENTRY_COLS = `t.id, t.kind, t.who, to_char(t.day, 'YYYY-MM-DD') AS day, t.minutes, t.rate_cents, t.amount_cents, t.description,
  t.billable, t.bill_id, b.number AS bill_number,
  CASE WHEN t.kind = 'time' THEN round(t.minutes * t.rate_cents / 60.0) ELSE t.amount_cents END AS value_cents`;

export async function listEntries(me: Me, matterId: string, opts: { mineOnly?: boolean } = {}) {
  await access(me.email, matterId);
  return q<Entry>(
    `SELECT ${ENTRY_COLS} FROM time_entries t LEFT JOIN bills b ON b.id = t.bill_id
     WHERE t.matter_id = $1 AND ($2 = false OR t.who = $3) ORDER BY t.day DESC, t.created_at DESC LIMIT 2000`,
    [matterId, !!opts.mineOnly, me.email],
  );
}

/** One person's time across matters, for a week view. */
export async function myTime(me: Me, from: string, to: string) {
  return q(
    `SELECT ${ENTRY_COLS}, t.matter_id, m.number, m.title AS matter_title FROM time_entries t
     JOIN matters m ON m.id = t.matter_id LEFT JOIN bills b ON b.id = t.bill_id
     WHERE t.who = $1 AND t.day BETWEEN $2 AND $3 ORDER BY t.day DESC, t.created_at DESC`,
    [me.email, from, to],
  );
}

/** The rate for a person on a matter: their own on the team, else the matter's. */
async function rateFor(tq: Tq | typeof q, matterId: string, who: string): Promise<number> {
  const [r] = await tq<{ rate: string | null }>(
    `SELECT COALESCE((SELECT rate_cents FROM matter_people WHERE matter_id = $1 AND email = $2), m.rate_cents, 0) AS rate FROM matters m WHERE m.id = $1`,
    [matterId, who],
  );
  return Number(r?.rate ?? 0);
}

export async function addEntry(me: Me, matterId: string, b: Record<string, unknown>) {
  const { m, role } = await access(me.email, matterId);
  if (m.status === "closed") throw new UserError("This matter is closed");
  const who = b.who && String(b.who).toLowerCase() !== me.email ? cleanEmail(b.who) : me.email;
  if (who !== me.email && role !== "responsible" && role !== "admin") throw new UserError("Only the responsible lawyer records time for someone else", 403);
  const kind = b.kind === "expense" ? "expense" : "time";
  const d = dayOrNull(b.day, "Date") ?? new Date().toISOString().slice(0, 10);
  const description = text(b.description, 2000);
  if (!description) throw new UserError("Describe the work or the expense");
  const billable = b.billable === undefined ? m.fee_type !== "pro_bono" : !!b.billable;
  let mins = 0;
  let rate = 0;
  let amount = 0;
  if (kind === "time") {
    mins = minutes(b.hours);
    if (mins <= 0) throw new UserError("Enter the time, like 1.5 or 1:30");
    if (mins > 1440) throw new UserError("That's more than a day");
    rate = b.rate === undefined || b.rate === "" ? await rateFor(q, matterId, who) : (cents(b.rate, "Rate") ?? 0);
  } else {
    amount = cents(b.amount, "Amount") ?? 0;
    if (amount <= 0) throw new UserError("Enter the amount");
  }
  const [row] = await q<{ id: string }>(
    `INSERT INTO time_entries (matter_id, kind, who, day, minutes, rate_cents, amount_cents, description, billable)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id`,
    [matterId, kind, who, d, mins, rate, amount, description, billable],
  );
  return row;
}

async function entryFor(me: Me, id: string) {
  if (!uuidish(id)) throw new UserError("Not found", 404);
  const [e] = await q<{ matter_id: string; who: string; kind: string; bill_id: string | null }>(
    `SELECT matter_id, who, kind, bill_id FROM time_entries WHERE id = $1`,
    [id],
  );
  if (!e) throw new UserError("Not found", 404);
  const { role } = await access(me.email, e.matter_id);
  if (e.who !== me.email && role !== "responsible" && role !== "admin") throw new UserError("Only the person who recorded it or the responsible lawyer can change it", 403);
  if (e.bill_id) throw new UserError("It's on a bill. Cancel the bill first to change it.", 409);
  return e;
}

export async function updateEntry(me: Me, id: string, b: Record<string, unknown>) {
  const e = await entryFor(me, id);
  const sets: string[] = [];
  const params: unknown[] = [id];
  const set = (col: string, v: unknown) => {
    params.push(v);
    sets.push(`${col} = $${params.length}`);
  };
  if (b.day !== undefined) set("day", dayOrNull(b.day, "Date") ?? new Date().toISOString().slice(0, 10));
  if (b.description !== undefined) {
    const d = text(b.description, 2000);
    if (!d) throw new UserError("Describe the work or the expense");
    set("description", d);
  }
  if (b.billable !== undefined) set("billable", !!b.billable);
  if (e.kind === "time" && b.hours !== undefined) {
    const mins = minutes(b.hours);
    if (mins <= 0 || mins > 1440) throw new UserError("Enter the time, like 1.5 or 1:30");
    set("minutes", mins);
  }
  if (e.kind === "time" && b.rate !== undefined) set("rate_cents", cents(b.rate, "Rate") ?? 0);
  if (e.kind === "expense" && b.amount !== undefined) {
    const a = cents(b.amount, "Amount") ?? 0;
    if (a <= 0) throw new UserError("Enter the amount");
    set("amount_cents", a);
  }
  if (!sets.length) return;
  await q(`UPDATE time_entries SET ${sets.join(", ")}, modified_at = now() WHERE id = $1`, params);
}

export async function deleteEntry(me: Me, id: string) {
  await entryFor(me, id);
  await q(`DELETE FROM time_entries WHERE id = $1`, [id]);
}

export type BillLine = { description: string; quantity: number; unitCents: number; amountCents: number };

/** What a bill through `through` would hold. */
async function gather(tq: Tq | typeof q, matterId: string, through: string) {
  const [m] = await tq<{ number: string; title: string; fee_type: string; flat_cents: string | null; currency: string }>(
    `SELECT number, title, fee_type, flat_cents, currency FROM matters WHERE id = $1`,
    [matterId],
  );
  const rows = await tq<Entry>(
    `SELECT ${ENTRY_COLS} FROM time_entries t LEFT JOIN bills b ON b.id = t.bill_id
     WHERE t.matter_id = $1 AND t.bill_id IS NULL AND t.billable AND t.day <= $2 ORDER BY t.day, t.created_at`,
    [matterId, through],
  );
  const lines: BillLine[] = [];
  const [{ n: billedBefore }] = await tq<{ n: string }>(`SELECT count(*) AS n FROM bills WHERE matter_id = $1`, [matterId]);
  if (m.fee_type === "flat" && m.flat_cents && Number(billedBefore) === 0) {
    lines.push({ description: `Flat fee: ${m.title}`, quantity: 1, unitCents: Number(m.flat_cents), amountCents: Number(m.flat_cents) });
  }
  for (const r of rows) {
    if (r.kind === "time") {
      const hours = Math.round((r.minutes / 60) * 100) / 100;
      lines.push({
        description: `${r.day} ${r.who.split("@")[0]}: ${r.description}`,
        quantity: hours,
        unitCents: Number(r.rate_cents),
        amountCents: Number(r.value_cents),
      });
    } else {
      lines.push({ description: `${r.day} Expense: ${r.description}`, quantity: 1, unitCents: Number(r.amount_cents), amountCents: Number(r.amount_cents) });
    }
  }
  const totalCents = lines.reduce((a, l) => a + l.amountCents, 0);
  return { matter: m, lines, ids: rows.map((r) => r.id), totalCents, currency: m.currency };
}

export async function previewBill(me: Me, matterId: string, through: string) {
  await requireLead(me.email, matterId);
  const day = dayOrNull(through, "Bill through") ?? new Date().toISOString().slice(0, 10);
  const { lines, totalCents, currency } = await gather(q, matterId, day);
  return { through: day, lines, totalCents, currency, books: booksConfigured() };
}

export async function createBill(me: Me, matterId: string, b: Record<string, unknown>) {
  await requireLead(me.email, matterId);
  const through = dayOrNull(b.through, "Bill through") ?? new Date().toISOString().slice(0, 10);
  return tx(async (tq) => {
    await tq(`SELECT id FROM matters WHERE id = $1 FOR UPDATE`, [matterId]);
    const g = await gather(tq, matterId, through);
    if (!g.lines.length || g.totalCents <= 0) throw new UserError("There is nothing to bill up to that day");
    const [c] = await tq<{ name: string; email: string }>(`SELECT c.name, c.email FROM matters m JOIN clients c ON c.id = m.client_id WHERE m.id = $1`, [matterId]);
    const books = booksConfigured();
    const [{ n }] = await tq<{ n: string }>(`SELECT nextval('bill_number_seq') AS n`);
    const number = `B-${String(n).padStart(5, "0")}`;
    const [bill] = await tq<{ id: string }>(
      `INSERT INTO bills (number, matter_id, status, through_day, total_cents, currency, lines, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
      [number, matterId, books ? "pending" : "recorded", through, g.totalCents, g.currency, JSON.stringify(g.lines), me.email],
    );
    await tq(`UPDATE time_entries SET bill_id = $2 WHERE id = ANY($1::uuid[])`, [g.ids, bill.id]);
    if (books) {
      const out = await createDraftInvoice({
        customer: { name: c.name, ...(c.email ? { email: c.email } : {}) },
        invoiceDate: new Date().toISOString().slice(0, 10),
        memo: `${g.matter.number} ${g.matter.title}: services through ${through}`,
        reference: `${g.matter.number} ${number}`,
        currency: g.currency,
        lines: g.lines.map((l) => ({ description: l.description, quantity: l.quantity, unitPrice: l.unitCents / 100 })),
      });
      await tq(`UPDATE bills SET status = 'sent', books_id = $2, books_number = $3 WHERE id = $1`, [bill.id, out.id, out.number]);
    }
    await logEvent(tq, matterId, "billed", `${number} for ${(g.totalCents / 100).toFixed(2)} ${g.currency}${books ? ", sent to Books as a draft invoice" : ""}`, me.email);
    return { id: bill.id, number };
  });
}

export async function listBills(me: Me, matterId: string) {
  await access(me.email, matterId);
  const rows = await q<{ id: string; number: string; status: string; through_day: string; total_cents: string; currency: string; lines: BillLine[]; books_id: string | null; books_number: string | null; created_by: string; created_at: Date }>(
    `SELECT id, number, status, to_char(through_day, 'YYYY-MM-DD') AS through_day, total_cents, currency, lines, books_id, books_number, created_by, created_at
     FROM bills WHERE matter_id = $1 ORDER BY created_at DESC`,
    [matterId],
  );
  const paid = await q<{ bill_id: string; cents: string }>(
    `SELECT bill_id, sum(amount_cents) AS cents FROM trust_txns WHERE bill_id = ANY($1::uuid[]) AND voided_at IS NULL GROUP BY bill_id`,
    [rows.map((r) => r.id)],
  );
  const fromTrust = new Map(paid.map((p) => [p.bill_id, Number(p.cents)]));
  return rows.map((r) => ({ ...r, booksUrl: r.books_id ? booksInvoicesUrl() : null, paidFromTrustCents: fromTrust.get(r.id) ?? 0 }));
}

/**
 * Puts a bill's entries back to unbilled. Only for a bill nothing has been paid on from trust; a
 * Books invoice is voided in Books as well.
 */
export async function cancelBill(me: Me, billId: string) {
  if (!uuidish(billId)) throw new UserError("Not found", 404);
  const [bill] = await q<{ matter_id: string; number: string }>(`SELECT matter_id, number FROM bills WHERE id = $1`, [billId]);
  if (!bill) throw new UserError("Not found", 404);
  await requireLead(me.email, bill.matter_id);
  await tx(async (tq) => {
    const [{ n }] = await tq<{ n: string }>(`SELECT count(*) AS n FROM trust_txns WHERE bill_id = $1 AND voided_at IS NULL`, [billId]);
    if (Number(n) > 0) throw new UserError("Trust money has been applied to this bill. Void that transfer first.", 409);
    await tq(`UPDATE time_entries SET bill_id = NULL WHERE bill_id = $1`, [billId]);
    await tq(`UPDATE trust_txns SET bill_id = NULL WHERE bill_id = $1`, [billId]);
    await tq(`DELETE FROM bills WHERE id = $1`, [billId]);
    await logEvent(tq, bill.matter_id, "billed", `${bill.number} cancelled`, me.email);
  });
}
