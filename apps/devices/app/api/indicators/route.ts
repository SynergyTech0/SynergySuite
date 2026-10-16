import { adminRoute, body } from "@/lib/api";
import { addIndicators, listIndicators, removeIndicator } from "@/lib/devices";

export const GET = adminRoute(async () => listIndicators());

/** { hashes: "sha256 sha256 …", title } */
export const POST = adminRoute(async (me, req) => ({ added: await addIndicators(me, await body(req)) }));

/** ?sha256= */
export const DELETE = adminRoute(async (me, req) => {
  await removeIndicator(me, new URL(req.url).searchParams.get("sha256") ?? "");
  return { ok: true };
});
