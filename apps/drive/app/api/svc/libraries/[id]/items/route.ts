import type { Params } from "@/lib/api";
import { listManagedLibrary, svcRoute } from "@/lib/svc";

export const GET = svcRoute(async (req, { params }: Params<"id">) =>
  listManagedLibrary((await params).id, new URL(req.url).searchParams.get("folder") ?? ""),
);
