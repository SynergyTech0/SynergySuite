import { memberships, svcRoute } from "@/lib/svc";

/** Every group a person is in, nested groups included: ?email= (suite servers only). */
export const GET = svcRoute(async (req) => memberships(new URL(req.url).searchParams.get("email") ?? ""));
