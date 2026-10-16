import { type Params, route } from "@/lib/api";
import * as drive from "@/lib/drive";

/** Restore this version. */
export const POST = route(async (me, _req, { params }: Params<"id" | "n">) => {
  const { id, n } = await params;
  await drive.restoreVersion(me, id, Number(n));
  return { ok: true };
});
