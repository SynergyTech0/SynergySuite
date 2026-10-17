import { body, route, type Params } from "@/lib/api";
import { backToDraft, decide, renew, signedByHand, submitForApproval, terminate } from "@/lib/contracts";
import { reviewContract } from "@/lib/review";
import { sendForSignature } from "@/lib/sign";
import { UserError } from "@/lib/util";

/** The contract's life cycle: { action, ...details }. */
export const POST = route(async (me, req, { params }: Params<"id">) => {
  const id = (await params).id;
  const b = await body(req);
  switch (b.action) {
    case "submit": return submitForApproval(me, id, b);
    case "approve": return decide(me, id, { ...b, decision: "approve" });
    case "reject": return decide(me, id, { ...b, decision: "reject" });
    case "draft": return backToDraft(me, id);
    case "sign": return sendForSignature(me, id, b);
    case "signed": return signedByHand(me, id);
    case "renew": return renew(me, id, b);
    case "terminate": return terminate(me, id, b);
    case "review": return reviewContract(me, id);
    default: throw new UserError("Unknown action");
  }
});
