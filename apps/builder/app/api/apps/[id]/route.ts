import { body, route } from "@/lib/http";
import { deleteApp, getApp, updateApp } from "@/lib/apps";

type P = { id: string };

/** The app: its published definition, and the draft for owners and editors. */
export const GET = route<P>(async (_req, me, { id }) => ({ app: await getApp(id, me.email) }));

/** PATCH `{ name?, description?, color?, definition? }` saves the draft. */
export const PATCH = route<P>(async (req, me, { id }) => ({ app: await updateApp(id, me.email, await body(req)) }));

export const DELETE = route<P>(async (_req, me, { id }) => {
  await deleteApp(id, me.email);
});
