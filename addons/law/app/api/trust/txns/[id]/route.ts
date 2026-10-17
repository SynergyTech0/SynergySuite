import { type Params, body, route } from "@/lib/api";
import { retryBooks, voidTxn } from "@/lib/trust";
import { UserError } from "@/lib/util";

/** `{ action: "void", reason }` or `{ action: "retry" }` to send it to Books again. */
export const POST = route(async (me, req, { params }: Params<"id">) => {
  const { id } = await params;
  const b = await body(req);
  if (b.action === "void") return voidTxn(me, id, b);
  if (b.action === "retry") return retryBooks(me, id);
  throw new UserError("Unknown action");
});
