import { isAiConfigured } from "@synergy/ai";
import { route } from "@/lib/api";
import { limits, usage } from "@/lib/drive";

export const GET = route(async (me) => ({
  email: me.email,
  name: me.name,
  used: await usage(me.email),
  quota: limits().quota,
  ai: isAiConfigured({ prefix: "DRIVE_" }),
}));
