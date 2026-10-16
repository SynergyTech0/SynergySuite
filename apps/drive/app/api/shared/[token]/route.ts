import { type Params, publicRoute } from "@/lib/api";
import * as drive from "@/lib/drive";

/** What a view link shows: the file, or a folder and what's in it (?item= for a folder inside). */
export const GET = publicRoute(async (req, { params }: Params<"token">) =>
  drive.linkView((await params).token, new URL(req.url).searchParams.get("item")),
);
