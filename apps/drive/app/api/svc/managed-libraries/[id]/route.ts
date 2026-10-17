import type { Params } from "@/lib/api";
import { deleteManagedLibrary, svcRoute, updateManagedLibrary } from "@/lib/managed";

export const PUT = svcRoute(async (req, { params }: Params<"id">) => {
  await updateManagedLibrary((await params).id, await req.json().catch(() => ({})));
});

export const DELETE = svcRoute(async (_req, { params }: Params<"id">) => {
  await deleteManagedLibrary((await params).id);
});
