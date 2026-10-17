import { body, route } from "@/lib/api";
import { createClient, listClients } from "@/lib/law";

export const GET = route(async (_me, req) => listClients(new URL(req.url).searchParams.get("q")?.trim() ?? ""));
export const POST = route(async (me, req) => createClient(me, await body(req)));
