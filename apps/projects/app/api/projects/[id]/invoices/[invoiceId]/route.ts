import { type Params, route } from "@/lib/api";
import { cancelInvoice, invoiceCsv, invoices } from "@/lib/billing";
import { UserError } from "@/lib/util";

/** The billing run's lines as CSV. */
export const GET = route(async (me, _req, { params }: Params<"id" | "invoiceId">) => {
  const { id, invoiceId } = await params;
  const inv = (await invoices(me.email, id)).find((i) => i.id === invoiceId);
  if (!inv) throw new UserError("Invoice not found", 404);
  return new Response(invoiceCsv(inv), {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="invoice-${inv.throughDay}.csv"`,
    },
  });
});

/** Puts the time and expenses on it back to unbilled. */
export const DELETE = route(async (me, _req, { params }: Params<"id" | "invoiceId">) => {
  const { id, invoiceId } = await params;
  await cancelInvoice(me.email, id, invoiceId);
});
