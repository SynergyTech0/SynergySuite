import { type Params, body, route } from "@/lib/api";
import { bill, previewBilling } from "@/lib/billing";

/** What would be billed through a date (?through=YYYY-MM-DD&groupBy=task|person|entry&fee=). */
export const GET = route(async (me, req, { params }: Params<"id">) => {
  const s = new URL(req.url).searchParams;
  return previewBilling(me.email, (await params).id, { through: s.get("through"), groupBy: s.get("groupBy") ?? undefined, fee: s.get("fee") ?? undefined });
});

/** Bills it: a draft invoice in Books, or a record here when Books isn't connected. */
export const POST = route(async (me, req, { params }: Params<"id">) => bill(me.email, (await params).id, await body(req)));
