import { type Params, body, route } from "@/lib/api";
import { addPart } from "@/lib/parts";

/** A part used: { sku, qty } from the Commerce catalog, or { name, qty, unitPrice } without it. */
export const POST = route(async (me, req, { params }: Params<"id">) => {
  await addPart(me.email, (await params).id, await body(req));
});
