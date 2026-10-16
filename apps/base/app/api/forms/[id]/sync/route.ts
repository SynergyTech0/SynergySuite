import { route } from "@/lib/http";
import { syncResponses } from "@/lib/forms";

/** Brings the online form's new responses into the table. */
export const POST = route<{ id: string }>(async (_req, me, { id }) => syncResponses(id, me.email));
