import { body, route } from "@/lib/http";
import { getLink, makeLink, removeLink } from "@/lib/dataLinks";

type P = { id: string };

/** GET ?kind=table|query&source=<id>: the source's data link, or null. */
export const GET = route<P>(async (req, me, { id }) => {
  const sp = new URL(req.url).searchParams;
  return { link: await getLink(id, me.email, { kind: sp.get("kind"), id: sp.get("source") }) };
});

/** POST `{ kind, id }` makes the source's data link (editors). */
export const POST = route<P>(async (req, me, { id }) => ({ link: await makeLink(id, me.email, await body(req)) }));

/** DELETE `{ kind, id }` turns it off. */
export const DELETE = route<P>(async (req, me, { id }) => {
  await removeLink(id, me.email, await body(req));
  return { link: null };
});
