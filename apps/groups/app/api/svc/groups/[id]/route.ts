import type { Params } from "@/lib/api";
import { detail, svcRoute } from "@/lib/svc";

/** A group's owners and flattened members (suite servers only). */
export const GET = svcRoute(async (_req, { params }: Params<"id">) => detail((await params).id));
