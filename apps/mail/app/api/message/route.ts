import { matchLabel } from "@synergy/compliance";
import { route, accountFor, param, uidParam } from "@/lib/api";
import { getMessage } from "@/lib/mailbox";
import { policy } from "@/lib/policy";

export const dynamic = "force-dynamic";

export const GET = route(async (ctx, req) => {
  const url = new URL(req.url);
  const account = param(url, "account");
  const folder = param(url, "folder");
  const uid = uidParam(param(url, "uid"));
  const acct = await accountFor(ctx, account);
  const attachmentUrl = (index: number) =>
    `/api/attachment?${new URLSearchParams({ account, folder, uid: String(uid), index: String(index), inline: "1" })}`;
  const { msipLabel, ...m } = await getMessage(acct, folder, uid, { allowRemoteImages: url.searchParams.get("images") === "1", attachmentUrl });
  // Only labels the suite knows are shown: by id, or by name for mail labeled in another organization.
  const label = msipLabel ? matchLabel(await policy().labels(), msipLabel.id, msipLabel.name) : null;
  return { ...m, label };
});
