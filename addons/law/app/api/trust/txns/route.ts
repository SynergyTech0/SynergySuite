import { body, route } from "@/lib/api";
import { ledger, record } from "@/lib/trust";

/** `?client=` lists one client's trust history across accounts. */
export const GET = route(async (me, req) => ledger(me, { clientId: new URL(req.url).searchParams.get("client") ?? undefined }));
export const POST = route(async (me, req) => record(me, await body(req)));
