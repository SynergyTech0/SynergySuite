import { body, route, type Params } from "@/lib/api";
import { erase, lock, power } from "@/lib/mdm/apple";
import { UserError } from "@/lib/util";

/**
 * lock { message?, phone? } (admins or the owner), erase { confirm, keep_data_plan? } (admins),
 * restart and shutdown (admins).
 */
export const POST = route(async (me, req, { params }: Params<"id" | "action">) => {
  const { id, action } = await params;
  switch (action) {
    case "lock":
      return lock(me, id, await body(req));
    case "erase":
      return erase(me, id, await body(req));
    case "restart":
    case "shutdown":
      await power(me, id, action);
      return { ok: true };
    default:
      throw new UserError("Not found", 404);
  }
});
