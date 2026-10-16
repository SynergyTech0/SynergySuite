import { route, accountFor, param } from "@/lib/api";
import { createFolder, listFolders } from "@/lib/mailbox";

export const dynamic = "force-dynamic";

export const GET = route(async (ctx, req) => {
  const url = new URL(req.url);
  return { folders: await listFolders(await accountFor(ctx, param(url, "account"))) };
});

export const POST = route(async (ctx, req) => {
  const b = await req.json().catch(() => ({}));
  return { path: await createFolder(await accountFor(ctx, String(b.account || "")), String(b.name || "")) };
});
