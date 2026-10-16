import { HttpError, route } from "@/lib/http";
import { restoreVersion } from "@/lib/apps";

/** POST copies that published version back into the draft. */
export const POST = route<{ id: string; version: string }>(async (_req, me, { id, version }) => {
  const v = Number(version);
  if (!Number.isInteger(v) || v < 1) throw new HttpError(400, "Bad version");
  return { app: await restoreVersion(id, me.email, v) };
});
