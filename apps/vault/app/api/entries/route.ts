import { body, route } from "@/lib/api";
import { createEntry, listEntries } from "@/lib/vault";

export const GET = route(async () => listEntries());
export const POST = route(async (me, req) => createEntry(me, await body(req)));
