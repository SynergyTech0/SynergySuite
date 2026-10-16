import { body, route } from "@/lib/http";
import { deleteForm, getForm, updateForm } from "@/lib/forms";

type P = { id: string };

export const GET = route<P>(async (_req, me, { id }) => ({ form: await getForm(id, me.email) }));

export const PATCH = route<P>(async (req, me, { id }) => ({ form: await updateForm(id, me.email, await body(req)) }));

export const DELETE = route<P>(async (_req, me, { id }) => {
  await deleteForm(id, me.email);
});
