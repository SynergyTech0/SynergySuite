import { type Params, body, route } from "@/lib/api";
import { setStaff } from "@/lib/pages";

/** Replaces the page's staff: [{ email, name, role, hours }]. */
export const PUT = route(async (me, req, { params }: Params<"id">) => setStaff(me, (await params).id, (await body<{ staff?: unknown }>(req)).staff));
