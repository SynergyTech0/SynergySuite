import { filters, route } from "@/lib/api";
import * as referrals from "@/lib/referrals";

/** ?stage=new|qualified|won|lost, ?partnerId=, ?unpaid=1 (won and still owed), ?q= */
export const GET = route(async (ctx, req) => referrals.list(ctx, filters(req)));
