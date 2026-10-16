import { type Params, body, vroute } from "@/lib/api";
import { cancelTimeOff, decideTimeOff } from "@/lib/hr";
import { UserError } from "@/lib/util";

export const POST = vroute(async (v, req, { params }: Params<"id" | "action">) => {
  const { id, action } = await params;
  if (action === "decide") return decideTimeOff(v, id, await body(req));
  if (action === "cancel") return cancelTimeOff(v, id);
  throw new UserError("Not found", 404);
});
