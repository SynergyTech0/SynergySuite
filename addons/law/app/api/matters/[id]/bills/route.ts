import { type Params, body, route } from "@/lib/api";
import { createBill, listBills, previewBill } from "@/lib/billing";

/** The matter's bills; `?preview=YYYY-MM-DD` shows what a bill through that day would hold. */
export const GET = route(async (me, req, { params }: Params<"id">) => {
  const { id } = await params;
  const preview = new URL(req.url).searchParams.get("preview");
  return preview !== null ? previewBill(me, id, preview) : listBills(me, id);
});
export const POST = route(async (me, req, { params }: Params<"id">) => createBill(me, (await params).id, await body(req)));
