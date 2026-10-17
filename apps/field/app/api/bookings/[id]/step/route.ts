import { type Params, body, route } from "@/lib/api";
import { type Step, step } from "@/lib/schedule";
import { UserError } from "@/lib/util";

/** Moves a visit along: { step: "travel" | "arrive" | "finish" } */
export const POST = route(async (me, req, { params }: Params<"id">) => {
  const s = (await body(req)).step;
  if (s !== "travel" && s !== "arrive" && s !== "finish") throw new UserError("step must be travel, arrive or finish");
  return step(me.email, (await params).id, s as Step);
});
