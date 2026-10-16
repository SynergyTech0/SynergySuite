import { body, route } from "@/lib/api";
import * as drive from "@/lib/drive";

/** One view of Drive: a folder (?parent= or ?library=), or recent, starred, shared, search, trash. */
export const GET = route(async (me, req) => {
  const url = new URL(req.url);
  const view = url.searchParams.get("view") ?? "files";
  const target = { parent: url.searchParams.get("parent"), library: url.searchParams.get("library") };
  switch (view) {
    case "recent":
      return { items: await drive.recent(me) };
    case "starred":
      return { items: await drive.starred(me) };
    case "shared":
      return { items: await drive.sharedWithMe(me) };
    case "sharedbyme":
      return { items: await drive.sharedByMe(me) };
    case "search":
      return { items: await drive.search(me, url.searchParams.get("q") ?? "") };
    case "trash":
      return { items: await drive.trash(me) };
    case "folders":
      return drive.folders(me, target);
    default:
      return drive.listFolder(me, target);
  }
});

/** New folder. */
export const POST = route(async (me, req) => {
  const b = await body<{ name?: string; parent?: string; library?: string }>(req);
  return drive.createFolder(me, { parent: b.parent, library: b.library }, b.name ?? "");
});
