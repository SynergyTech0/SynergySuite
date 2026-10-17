import { body, route } from "@/lib/api";
import { createSource, listSources } from "@/lib/migrate";

/** Move from Microsoft 365 (or another IMAP server): the connected sources, and connecting one. */
export const GET = route("migrate", async () => listSources());
export const POST = route("migrate", async (me, req) => createSource(me, await body(req)));
