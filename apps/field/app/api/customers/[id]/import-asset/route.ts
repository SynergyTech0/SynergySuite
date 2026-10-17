import { type Params, body, route } from "@/lib/api";
import { importOpsAsset } from "@/lib/ops";

/** Brings an asset from Ops onto this customer by its tag. */
export const POST = route(async (me, req, { params }: Params<"id">) => importOpsAsset(me.email, (await params).id, (await body(req)).tag));
