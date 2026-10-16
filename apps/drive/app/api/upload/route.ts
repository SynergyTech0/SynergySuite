import { route } from "@/lib/api";
import * as drive from "@/lib/drive";

/**
 * The request body is the file itself, streamed to disk as it arrives, so uploads of any size
 * never sit in memory. ?path= is its name, or "folder/sub/name" when a whole folder is uploaded.
 */
export const PUT = route(async (me, req) => {
  const url = new URL(req.url);
  const len = req.headers.get("content-length");
  return drive.upload(
    me,
    { parent: url.searchParams.get("parent"), library: url.searchParams.get("library") },
    url.searchParams.get("path") ?? "",
    req.body,
    len ? Number(len) : undefined,
  );
});
