import { route } from "@/lib/http";
import { publishApp } from "@/lib/apps";

/** POST publishes the draft as the next version. */
export const POST = route<{ id: string }>(async (_req, me, { id }) => ({ app: await publishApp(id, me.email) }));
