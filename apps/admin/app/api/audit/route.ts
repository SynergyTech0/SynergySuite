import { route } from "@/lib/api";
import { list } from "@/lib/audit";

export const GET = route("audit", async (_me, req) => {
  const u = new URL(req.url).searchParams;
  const s = (k: string) => u.get(k) ?? undefined;
  return list({ q: s("q"), actor: s("actor"), action: s("action"), from: s("from"), to: s("to"), before: s("before") });
});
