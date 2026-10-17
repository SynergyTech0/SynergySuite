import { q } from "./db";
import { call, linked, openUrls } from "./links";
import { getSettings, requireDispatcher } from "./staff";
import { UserError, text } from "./util";
import { access, event } from "./workorders";

/**
 * Billing a finished job. The invoice is the time on site at each technician's rate, the parts
 * used at their price, and the trip fee once per visit. With Books linked (BOOKS_SVC_TOKEN) it
 * goes to Books' POST /api/svc/invoices as a draft for the customer, to be reviewed and sent
 * there; otherwise Field Service records it and the lines can be copied out.
 */
export type Line = { description: string; quantity: number; unitCents: number; amountCents: number; kind: "labor" | "part" | "trip" };

export type Invoice = {
  status: "none" | "sent" | "recorded"; lines: Line[]; totalCents: number; currency: string; booksLinked: boolean; booksNumber: string | null;
  booksUrl: string; billable: boolean; warranty: boolean;
};

const hours = (m: number) => Math.round((m / 60) * 100) / 100;

function name(email: string, names: Map<string, string>): string {
  return names.get(email) || email.split("@")[0];
}

/** What the job would bill now, or what it did bill. */
export async function preview(me: string, id: string): Promise<Invoice> {
  await requireDispatcher(me);
  await access(me, id);
  const [w] = await q<{ invoice_status: Invoice["status"]; invoice_lines: Line[] | null; invoice_total_cents: string | null; books_number: string | null; billable: boolean; warranty: boolean }>(
    `SELECT w.invoice_status, w.invoice_lines, w.invoice_total_cents, w.books_number, w.billable,
       COALESCE(a.warranty_until >= CURRENT_DATE, false) AS warranty
     FROM work_orders w LEFT JOIN assets a ON a.id = w.asset_id WHERE w.id = $1`,
    [id],
  );
  const settings = await getSettings();
  const base = { booksLinked: linked("books"), booksNumber: w.books_number, booksUrl: openUrls().books, billable: w.billable, warranty: w.warranty, currency: settings.currency };
  if (w.invoice_status !== "none") {
    return { ...base, status: w.invoice_status, lines: w.invoice_lines ?? [], totalCents: Number(w.invoice_total_cents ?? 0) };
  }
  const lines = await linesFor(id, settings.tripFeeCents);
  return { ...base, status: "none", lines, totalCents: lines.reduce((a, l) => a + l.amountCents, 0) };
}

async function linesFor(id: string, tripFeeCents: number): Promise<Line[]> {
  const [labor, parts, visits, staff] = await Promise.all([
    q<{ technician: string; rate_cents: string; minutes: number }>(
      "SELECT technician, rate_cents, sum(minutes)::int AS minutes FROM labor WHERE work_order_id = $1 GROUP BY technician, rate_cents ORDER BY technician",
      [id],
    ),
    q<{ sku: string; name: string; unit: string; qty: string; unit_price_cents: string }>(
      "SELECT sku, name, unit, sum(qty) AS qty, unit_price_cents FROM parts WHERE work_order_id = $1 GROUP BY sku, name, unit, unit_price_cents ORDER BY min(id)",
      [id],
    ),
    q<{ n: number }>("SELECT count(*)::int AS n FROM bookings WHERE work_order_id = $1 AND status = 'done'", [id]),
    q<{ email: string; name: string }>("SELECT email, name FROM staff"),
  ]);
  const names = new Map(staff.map((s) => [s.email, s.name]));
  const lines: Line[] = [];
  for (const l of labor) {
    const quantity = hours(l.minutes);
    const unit = Number(l.rate_cents);
    lines.push({ description: `Labor: ${name(l.technician, names)} (${quantity} h)`, quantity, unitCents: unit, amountCents: Math.round(quantity * unit), kind: "labor" });
  }
  for (const p of parts) {
    const quantity = Number(p.qty);
    const unit = Number(p.unit_price_cents);
    lines.push({ description: p.sku ? `${p.name} (${p.sku})` : p.name, quantity, unitCents: unit, amountCents: Math.round(quantity * unit), kind: "part" });
  }
  if (tripFeeCents > 0 && visits[0].n > 0) {
    lines.push({ description: "Trip fee", quantity: visits[0].n, unitCents: tripFeeCents, amountCents: visits[0].n * tripFeeCents, kind: "trip" });
  }
  return lines;
}

/** Bills a completed job, once. */
export async function bill(me: string, id: string, b: Record<string, unknown> = {}): Promise<Invoice> {
  const inv = await preview(me, id);
  const [w] = await q<{ number: string; title: string; status: string; customer_name: string; customer_email: string; completed_at: Date }>(
    `SELECT w.number, w.title, w.status, c.name AS customer_name, c.email AS customer_email, w.completed_at
     FROM work_orders w JOIN customers c ON c.id = w.customer_id WHERE w.id = $1`,
    [id],
  );
  if (w.status !== "completed") throw new UserError("Complete the job before billing it", 409);
  if (inv.status !== "none") throw new UserError("This job has already been billed", 409);
  if (!inv.billable) throw new UserError("This job is marked not billable", 409);
  if (!inv.lines.length) throw new UserError("There's nothing to bill: no time, parts or trips are on this job", 400);

  // Claim the job first so two clicks can't make two invoices.
  const claimed = await q("UPDATE work_orders SET invoice_status = 'sent', invoiced_at = now() WHERE id = $1 AND invoice_status = 'none' RETURNING id", [id]);
  if (!claimed.length) throw new UserError("This job has already been billed", 409);
  let booksId: string | null = null;
  let booksNumber: string | null = null;
  let status: "sent" | "recorded" = "recorded";
  if (inv.booksLinked) {
    try {
      const out = await call<{ id?: string; number?: string }>("books", "POST", "/api/svc/invoices", {
        customer: { name: w.customer_name, ...(w.customer_email ? { email: w.customer_email } : {}) },
        invoiceDate: new Date(w.completed_at).toISOString().slice(0, 10),
        memo: text(b.memo, 500) || `${w.number}: ${w.title}`,
        reference: w.number,
        currency: inv.currency,
        lines: inv.lines.map((l) => ({ description: l.description, quantity: l.quantity, unitPrice: l.unitCents / 100 })),
      });
      if (!out.id) throw new UserError("Books didn't return the invoice", 502);
      booksId = out.id;
      booksNumber = out.number ?? null;
      status = "sent";
    } catch (e) {
      await q("UPDATE work_orders SET invoice_status = 'none', invoiced_at = NULL WHERE id = $1", [id]);
      throw e;
    }
  }
  await q(
    "UPDATE work_orders SET invoice_status = $2, books_id = $3, books_number = $4, invoice_total_cents = $5, invoice_lines = $6, modified_at = now() WHERE id = $1",
    [id, status, booksId, booksNumber, inv.totalCents, JSON.stringify(inv.lines)],
  );
  await event(q, id, me, status === "sent" ? `Billed to Books as draft invoice ${booksNumber ?? ""}`.trim() : "Billed (recorded here; Books isn't linked)");
  return preview(me, id);
}
