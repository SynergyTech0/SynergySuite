import { body, route } from "@/lib/api";
import { listCustomers, saveCustomer } from "@/lib/customers";

export const GET = route(async (me, req) => listCustomers(me.email, new URL(req.url).searchParams.get("q") ?? ""));
export const POST = route(async (me, req) => saveCustomer(me.email, null, await body(req)));
