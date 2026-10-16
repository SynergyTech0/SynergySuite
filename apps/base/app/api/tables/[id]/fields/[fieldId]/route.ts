import { body, route } from "@/lib/http";
import { deleteField, updateField } from "@/lib/catalog";

type P = { id: string; fieldId: string };

/** PATCH `{ name?, type?, options?, required?, description?, position? }`. */
export const PATCH = route<P>(async (req, me, { id, fieldId }) => ({ field: await updateField(id, fieldId, me.email, await body(req)) }));

export const DELETE = route<P>(async (_req, me, { id, fieldId }) => {
  await deleteField(id, fieldId, me.email);
});
