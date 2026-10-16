import { type Params, body, route } from "@/lib/api";
import * as drive from "@/lib/drive";
import type { DlpOverride } from "@/lib/protection";

/**
 * A view-only link anyone can open, optionally expiring after some days. Refused (422) for
 * labels that keep content inside and by DLP rules; a DLP warning (409) needs
 * `dlpOverride: { justification }` to go ahead.
 */
export const POST = route(async (me, req, { params }: Params<"id">) => {
  const { id } = await params;
  const b = await body<{ expiresDays?: number; dlpOverride?: DlpOverride }>(req);
  await drive.createLink(me, id, b.expiresDays, b.dlpOverride);
  return drive.sharing(me, id);
});

export const DELETE = route(async (me, req, { params }: Params<"id">) => {
  const { id } = await params;
  await drive.deleteLink(me, id, new URL(req.url).searchParams.get("token") ?? "");
  return drive.sharing(me, id);
});
