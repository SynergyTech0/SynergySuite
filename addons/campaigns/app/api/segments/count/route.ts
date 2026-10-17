import { body, route } from "@/lib/api";
import { cleanRules, countMatching } from "@/lib/segments";
import { UserError, isUuid } from "@/lib/util";

/** How many people some rules match, while they are being edited. */
export const POST = route(async (_ctx, req) => {
  const b = await body(req);
  if (!isUuid(b.audienceId)) throw new UserError("Pick an audience");
  return { count: await countMatching(b.audienceId, cleanRules(b.rules)) };
});
