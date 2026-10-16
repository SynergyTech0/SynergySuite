import { route } from "@/lib/http";
import { listDatabases } from "@/lib/services";

/** The Base databases the signed-in person can open, for the data picker. */
export const GET = route(async (_req, me) => ({ databases: await listDatabases(me.email) }));
