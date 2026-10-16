import { route } from "@/lib/api";
import { allHolds } from "@/lib/matters";

export const GET = route("compliance", async (me, req) => {
  const u = new URL(req.url).searchParams;
  return allHolds(me, { status: u.get("status") ?? undefined, custodian: u.get("custodian") ?? undefined });
});
