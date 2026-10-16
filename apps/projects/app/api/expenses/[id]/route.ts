import { type Params, body, route } from "@/lib/api";
import { deleteExpense, updateExpense } from "@/lib/time";

/** Edits a draft, or { status: "submitted" | "draft" } to submit or take it back. */
export const PATCH = route(async (me, req, { params }: Params<"id">) => updateExpense(me.email, (await params).id, await body(req)));

export const DELETE = route(async (me, _req, { params }: Params<"id">) => {
  await deleteExpense(me.email, (await params).id);
});
