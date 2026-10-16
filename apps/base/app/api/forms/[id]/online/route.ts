import { route } from "@/lib/http";
import { publishForm, unpublishForm } from "@/lib/forms";

type P = { id: string };

/** Publishes the form to Synergy Forms (or updates the online form with the current fields). */
export const POST = route<P>(async (_req, me, { id }) => publishForm(id, me.email));

/** Stops the online form taking responses. */
export const DELETE = route<P>(async (_req, me, { id }) => ({ form: await unpublishForm(id, me.email) }));
