import { type Params, route } from "@/lib/api";
import { invoices } from "@/lib/billing";

export const GET = route(async (me, _req, { params }: Params<"id">) => invoices(me.email, (await params).id));
