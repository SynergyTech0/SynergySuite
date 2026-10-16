import { body, route } from "@/lib/http";
import { createForm, listForms } from "@/lib/forms";

type P = { id: string };

export const GET = route<P>(async (_req, me, { id }) => ({ forms: await listForms(id, me.email) }));

/** POST `{ tableId, name?, layout? }` makes a form; without a layout it shows every field. */
export const POST = route<P>(async (req, me, { id }) => Response.json({ form: await createForm(id, me.email, await body(req)) }, { status: 201 }));
