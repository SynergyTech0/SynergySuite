import { type Params, body, route } from "@/lib/api";
import { deleteCustomer, getCustomer, saveCustomer } from "@/lib/customers";

export const GET = route(async (me, _req, { params }: Params<"id">) => getCustomer(me.email, (await params).id));
export const PUT = route(async (me, req, { params }: Params<"id">) => saveCustomer(me.email, (await params).id, await body(req)));
export const DELETE = route(async (me, _req, { params }: Params<"id">) => {
  await deleteCustomer(me.email, (await params).id);
});
