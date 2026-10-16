import { adminRoute, body } from "@/lib/api";
import { createPolicy, listPolicies } from "@/lib/devices";
import { RULES } from "@/lib/rules";

export const GET = adminRoute(async () => ({ policies: await listPolicies(), rules: RULES }));

/** { name, description, platforms, rules } or { template: "baseline" }. */
export const POST = adminRoute(async (me, req) => createPolicy(me, await body(req)));
