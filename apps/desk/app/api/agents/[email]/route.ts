import { route, type Params } from "@/lib/api";
import { remove } from "@/lib/agents";

/** Stops someone being an agent (admins only). Their tickets stay assigned to them until reassigned. */
export const DELETE = route(async (me, _req, { params }: Params<"email">) => {
  await remove(me, decodeURIComponent((await params).email));
});
