import { type Params, body, route } from "@/lib/api";
import { getPost } from "@/lib/engage";
import { postToChat, publicUrl } from "@/lib/suite";
import { UserError, text } from "@/lib/util";

/** Shares a post into a Chat channel the viewer is in, with an optional note. */
export const POST = route(async (me, req, { params }: Params<"id">) => {
  const p = await getPost(me.email, (await params).id);
  const b = await body(req);
  const note = text(b.note, 2000);
  const headline = p.title || p.body.split("\n")[0].slice(0, 200) || `${p.author.name}'s post`;
  const message = [note, `${headline} (${p.author.name}, Engage)`, `${publicUrl("engage")}/posts/${p.id}`].filter(Boolean).join("\n");
  try {
    await postToChat(me, Number(b.channelId), message);
  } catch (e) {
    throw new UserError(`Couldn't share to Chat: ${(e as Error).message}`, 502);
  }
});
