import { type Params, body, clientIp, publicRoute } from "@/lib/api";
import { type BookInput, bookPublic } from "@/lib/appointments";
import { limit } from "@/lib/ratelimit";

export const dynamic = "force-dynamic";

/** A customer books. Returns the secret token for their manage page. */
export const POST = publicRoute(async (req, { params }: Params<"slug">) => {
  limit(`book:${clientIp(req)}`, 10, 3_600_000);
  const b = await body<BookInput & { website?: string }>(req);
  // A field people never see; bots fill it in.
  if (b.website) return { token: null };
  const { token } = await bookPublic((await params).slug, b);
  return { token };
});
