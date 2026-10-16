import { type Params, route } from "@/lib/api";
import { files } from "@/lib/space";

/** The team library's most recently changed files, from Drive. */
export const GET = route(async (me, req, { params }: Params<"id">) => {
  const limit = Number(new URL(req.url).searchParams.get("limit")) || 12;
  return files(me, (await params).id, limit);
});
