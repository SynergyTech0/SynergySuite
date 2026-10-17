import { type Params, route } from "@/lib/api";
import { auditLog } from "@/lib/groups";

/** Owners: who changed what in the group. */
export const GET = route(async (me, _req, { params }: Params<"id">) => ({ entries: await auditLog(me, (await params).id) }));
