import { route, accountFor, param } from "@/lib/api";
import { listMessages } from "@/lib/mailbox";

export const dynamic = "force-dynamic";

export const GET = route(async (ctx, req) => {
  const url = new URL(req.url);
  const acct = await accountFor(ctx, param(url, "account"));
  return listMessages(acct, param(url, "folder"), {
    page: Number(url.searchParams.get("page") || 0),
    search: url.searchParams.get("q") || undefined,
  });
});
