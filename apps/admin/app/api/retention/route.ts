import { body, route } from "@/lib/api";
import { CONTENT_KINDS, suiteApps } from "@/lib/apps";
import { list, upsert } from "@/lib/retention";

export const GET = route("compliance", async (me) => ({
  rules: await list(),
  kinds: CONTENT_KINDS,
  apps: suiteApps().filter((a) => a.id !== "auth" && a.id !== "home").map((a) => ({ id: a.id, name: a.name })),
  canEdit: me.role === "admin",
}));
export const POST = route("retention.edit", async (me, req) => upsert(me, await body(req)));
