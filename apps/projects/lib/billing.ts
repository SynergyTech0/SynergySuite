import { booksConfigured, booksInvoicesUrl, createDraftInvoice } from "./books";
import { q, tx, type Tq } from "./db";
import { isDay } from "./dates";
import { requireManager } from "./projects";
import type { InvoiceLine, InvoiceRecord } from "./types";
import { UserError, cents, text, uuidish } from "./util";

/** How billed time is laid out on the invoice. */
export type Grouping = "task" | "person" | "entry";

export type BillingPreview = {
  billing: "time" | "fixed" | "none";
  currency: string;
  throughDay: string;
  lines: InvoiceLine[];
  totalCents: number;
  timeIds: string[];
  expenseIds: string[];
  /** Fixed-fee projects: the fee, and how much of it has been billed. */
  feeCents: number | null;
  feeBilledCents: number;
  books: boolean;
};

type TimeRow = { id: string; minutes: number; rate_cents: string | null; person: string; day: string; task_title: string | null; notes: string };
type ExpenseRow = { id: string; amount_cents: string; category: string; description: string; day: string };

/** Hours to two decimals, as an invoice shows them. */
const hours = (min: number) => Math.round((min / 60) * 100) / 100;

function timeLines(rows: TimeRow[], by: Grouping): InvoiceLine[] {
  const groups = new Map<string, { label: string; minutes: number; rate: number }>();
  for (const r of rows) {
    const rate = Number(r.rate_cents ?? 0);
    const task = r.task_title ?? "General";
    const label = by === "person" ? `${r.person}` : by === "entry" ? `${r.day} ${task}${r.notes ? `: ${r.notes}` : ""} (${r.person})` : task;
    const key = by === "entry" ? r.id : `${label}\u0000${rate}`;
    const g = groups.get(key) ?? { label, minutes: 0, rate };
    g.minutes += r.minutes;
    groups.set(key, g);
  }
  return [...groups.values()].map((g) => {
    const quantity = hours(g.minutes);
    return { description: text(g.label, 500), quantity, unitCents: g.rate, amountCents: Math.round(quantity * g.rate), kind: "time" as const };
  });
}

async function gather(tq: Tq, projectId: string, through: string, by: Grouping, fee: unknown, lock: boolean): Promise<BillingPreview> {
  const [p] = await tq<{ billing: "time" | "fixed" | "none"; currency: string; fixed_fee_cents: string | null }>(
    `SELECT billing, currency, fixed_fee_cents FROM projects WHERE id = $1::uuid`,
    [projectId],
  );
  const forUpdate = lock ? " FOR UPDATE OF e" : "";
  const time = p.billing === "time"
    ? await tq<TimeRow>(
        `SELECT e.id, e.minutes, e.rate_cents, e.person, to_char(e.day, 'YYYY-MM-DD') AS day, k.title AS task_title, e.notes
         FROM time_entries e LEFT JOIN tasks k ON k.id = e.task_id
         WHERE e.project_id = $1::uuid AND e.status = 'approved' AND e.billable AND e.invoice_id IS NULL AND e.held_deleted_at IS NULL AND e.day <= $2
         ORDER BY k.position NULLS LAST, e.day, e.person${forUpdate}`,
        [projectId, through],
      )
    : [];
  const expenses = p.billing === "none" ? [] : await tq<ExpenseRow>(
    `SELECT e.id, e.amount_cents, e.category, e.description, to_char(e.day, 'YYYY-MM-DD') AS day FROM expenses e
     WHERE e.project_id = $1::uuid AND e.status = 'approved' AND e.billable AND e.invoice_id IS NULL AND e.held_deleted_at IS NULL AND e.day <= $2
     ORDER BY e.day${forUpdate}`,
    [projectId, through],
  );
  const lines = timeLines(time, by);
  for (const x of expenses) {
    const amount = Number(x.amount_cents);
    lines.push({ description: text(`${x.category}${x.description ? `: ${x.description}` : ""} (${x.day})`, 500), quantity: 1, unitCents: amount, amountCents: amount, kind: "expense" });
  }
  const [billed] = await tq<{ c: string | null }>(
    `SELECT sum((l->>'amountCents')::bigint) AS c FROM invoices i, jsonb_array_elements(i.lines) l WHERE i.project_id = $1::uuid AND l->>'kind' = 'fee'`,
    [projectId],
  );
  const feeBilled = Number(billed.c ?? 0);
  const feeTotal = p.fixed_fee_cents === null ? null : Number(p.fixed_fee_cents);
  if (p.billing === "fixed") {
    const amount = fee === undefined || fee === null || fee === "" ? Math.max(0, (feeTotal ?? 0) - feeBilled) : cents(fee, "Fee") ?? 0;
    if (amount > 0) lines.unshift({ description: "Fixed fee", quantity: 1, unitCents: amount, amountCents: amount, kind: "fee" });
  }
  return {
    billing: p.billing,
    currency: p.currency,
    throughDay: through,
    lines,
    totalCents: lines.reduce((s, l) => s + l.amountCents, 0),
    timeIds: time.map((t) => t.id),
    expenseIds: expenses.map((x) => x.id),
    feeCents: feeTotal,
    feeBilledCents: feeBilled,
    books: booksConfigured(),
  };
}

function grouping(v: unknown): Grouping {
  if (v === undefined || v === null || v === "") return "task";
  if (v !== "task" && v !== "person" && v !== "entry") throw new UserError("Group by task, person or entry");
  return v;
}

/** What would be billed now: approved, billable, not yet billed, up to and including `through`. */
export async function previewBilling(email: string, projectId: string, v: { through?: unknown; groupBy?: unknown; fee?: unknown }): Promise<BillingPreview> {
  await requireManager(email, projectId);
  if (!isDay(v.through)) throw new UserError("Bad date");
  return gather(q, projectId, v.through, grouping(v.groupBy), v.fee, false);
}

/**
 * Bills the project: a draft invoice in Books for the client, or, without Books, a record here.
 * The time and expenses on it are marked billed in the same transaction, so a failure in Books
 * leaves everything unbilled and nothing is billed twice.
 */
export async function bill(
  email: string,
  projectId: string,
  v: { through?: unknown; groupBy?: unknown; fee?: unknown; invoiceDate?: unknown },
): Promise<InvoiceRecord> {
  await requireManager(email, projectId);
  if (!isDay(v.through)) throw new UserError("Bad date");
  const invoiceDate = v.invoiceDate === undefined || v.invoiceDate === "" ? v.through : v.invoiceDate;
  if (!isDay(invoiceDate)) throw new UserError("Bad invoice date");
  const through = v.through;
  const id = await tx(async (tq) => {
    // One billing run per project at a time.
    await tq(`SELECT id FROM projects WHERE id = $1::uuid FOR UPDATE`, [projectId]);
    const preview = await gather(tq, projectId, through, grouping(v.groupBy), v.fee, true);
    if (!preview.lines.length || preview.totalCents <= 0) throw new UserError("There is nothing to bill up to that date");
    const [p] = await tq<{ code: string; name: string; client_name: string; client_email: string }>(
      `SELECT code, name, client_name, client_email FROM projects WHERE id = $1::uuid`,
      [projectId],
    );
    const books = booksConfigured();
    if (books && !p.client_name && !p.client_email) throw new UserError("Add the client's name or email to the project first");
    const [inv] = await tq<{ id: string }>(
      `INSERT INTO invoices (project_id, status, through_day, total_cents, currency, lines, created_by)
       VALUES ($1::uuid, $2, $3, $4, $5, $6, $7) RETURNING id`,
      [projectId, books ? "pending" : "recorded", through, preview.totalCents, preview.currency, JSON.stringify(preview.lines), email],
    );
    await tq(`UPDATE time_entries SET invoice_id = $2::uuid WHERE id = ANY($1::uuid[])`, [preview.timeIds, inv.id]);
    await tq(`UPDATE expenses SET invoice_id = $2::uuid WHERE id = ANY($1::uuid[])`, [preview.expenseIds, inv.id]);
    if (books) {
      const out = await createDraftInvoice({
        customer: { name: p.client_name || p.client_email, ...(p.client_email ? { email: p.client_email } : {}) },
        invoiceDate,
        memo: `${p.code} ${p.name}: work through ${through}`,
        reference: p.code,
        currency: preview.currency,
        lines: preview.lines.map((l) => ({ description: l.description, quantity: l.quantity, unitPrice: l.unitCents / 100 })),
      });
      await tq(`UPDATE invoices SET status = 'sent', books_id = $2, books_number = $3 WHERE id = $1::uuid`, [inv.id, out.id, out.number]);
    }
    return inv.id;
  });
  return (await invoices(email, projectId)).find((i) => i.id === id)!;
}

type InvoiceRow = {
  id: string; status: InvoiceRecord["status"]; books_id: string | null; books_number: string | null; through_day: string;
  total_cents: string; currency: string; lines: InvoiceLine[]; created_by: string; created_at: Date;
};

export async function invoices(email: string, projectId: string): Promise<InvoiceRecord[]> {
  await requireManager(email, projectId);
  const rows = await q<InvoiceRow>(
    `SELECT id, status, books_id, books_number, to_char(through_day, 'YYYY-MM-DD') AS through_day, total_cents, currency, lines, created_by, created_at
     FROM invoices WHERE project_id = $1::uuid ORDER BY created_at DESC`,
    [projectId],
  );
  return rows.map((r) => ({
    id: r.id,
    status: r.status,
    booksNumber: r.books_number,
    booksUrl: r.books_id ? booksInvoicesUrl() : null,
    throughDay: r.through_day,
    totalCents: Number(r.total_cents),
    currency: r.currency,
    lines: r.lines,
    createdBy: r.created_by,
    createdAt: r.created_at.toISOString(),
  }));
}

/**
 * Undoes a billing run that was only recorded here (no Books invoice): its time and expenses go
 * back to unbilled. A Books invoice is voided in Books, then the run is cancelled here.
 */
export async function cancelInvoice(email: string, projectId: string, invoiceId: string): Promise<void> {
  await requireManager(email, projectId);
  if (!uuidish(invoiceId)) throw new UserError("Invoice not found", 404);
  await tx(async (tq) => {
    const [inv] = await tq<{ id: string }>(`SELECT id FROM invoices WHERE id = $1::uuid AND project_id = $2::uuid FOR UPDATE`, [invoiceId, projectId]);
    if (!inv) throw new UserError("Invoice not found", 404);
    await tq(`UPDATE time_entries SET invoice_id = NULL WHERE invoice_id = $1::uuid`, [invoiceId]);
    await tq(`UPDATE expenses SET invoice_id = NULL WHERE invoice_id = $1::uuid`, [invoiceId]);
    await tq(`DELETE FROM invoices WHERE id = $1::uuid`, [invoiceId]);
  });
}

/** An invoice's lines as CSV, for importing anywhere. */
export function invoiceCsv(inv: InvoiceRecord): string {
  const cell = (v: string | number) => {
    const s = String(v);
    return /[",\n]/.test(s) || /^[=+\-@]/.test(s) ? `"${s.replace(/^([=+\-@])/, "'$1").replace(/"/g, '""')}"` : s;
  };
  const rows = [["Description", "Quantity", "Unit price", "Amount", "Currency"]];
  for (const l of inv.lines) rows.push([l.description, String(l.quantity), (l.unitCents / 100).toFixed(2), (l.amountCents / 100).toFixed(2), inv.currency]);
  return rows.map((r) => r.map(cell).join(",")).join("\r\n") + "\r\n";
}
