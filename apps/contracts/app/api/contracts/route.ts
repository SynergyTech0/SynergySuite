import { body, route } from "@/lib/api";
import { listContracts, createContract } from "@/lib/contracts";
import { createFromTemplate } from "@/lib/library";

export const GET = route(async (me, req) => {
  const u = new URL(req.url).searchParams;
  return listContracts(me, { view: u.get("view") ?? undefined, status: u.get("status") ?? undefined, type: u.get("type") ?? undefined, q: u.get("q") ?? undefined });
});

/** A new draft: blank, or from a template when templateId is given. */
export const POST = route(async (me, req) => {
  const b = await body(req);
  return typeof b.templateId === "string" && b.templateId ? createFromTemplate(me, b.templateId, b) : createContract(me, b);
});
