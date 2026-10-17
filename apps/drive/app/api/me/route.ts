import { isAiAvailable } from "@synergy/ai";
import { route } from "@/lib/api";
import { limits, usage } from "@/lib/drive";

export const GET = route(async (me) => ({
  email: me.email,
  name: me.name,
  used: await usage(me.email),
  quota: limits().quota,
  ai: await isAiAvailable({ prefix: "DRIVE_" }),
}));
