import { body, route, type Params } from "@/lib/api";
import * as referrals from "@/lib/referrals";

/** Mark the reward paid: { paidOn?, amount?, note? }. The partner's owner or a manager. */
export const PUT = route(async (ctx, req, { params }: Params<"id">) => referrals.pay(ctx, (await params).id, await body(req)));

/** Undo a payment recorded by mistake. */
export const DELETE = route(async (ctx, _req, { params }: Params<"id">) => referrals.unpay(ctx, (await params).id));
