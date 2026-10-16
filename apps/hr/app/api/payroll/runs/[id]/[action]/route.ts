import { type Params, vroute } from "@/lib/api";
import { approveRun, payRun, postRun, recalcRun, reopenRun, voidRun } from "@/lib/payroll/runs";
import { UserError } from "@/lib/util";

const ACTIONS = { approve: approveRun, reopen: reopenRun, void: voidRun, pay: payRun, post: postRun, recalculate: recalcRun };

export const POST = vroute(async (v, _req, { params }: Params<"id" | "action">) => {
  const { id, action } = await params;
  const fn = ACTIONS[action as keyof typeof ACTIONS];
  if (!fn) throw new UserError("Not found", 404);
  await fn(v, id);
  return { ok: true };
});
