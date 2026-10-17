import { route, type Params } from "@/lib/api";
import * as referrals from "@/lib/referrals";

export const GET = route(async (ctx, _req, { params }: Params<"id">) => referrals.get(ctx, (await params).id));
