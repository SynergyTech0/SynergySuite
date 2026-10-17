import { body, route } from "@/lib/api";
import { saveDomains } from "@/lib/protection";

export const PUT = route("protection", async (me, req) => ({ domains: await saveDomains(me, (await body(req)).domains) }));
