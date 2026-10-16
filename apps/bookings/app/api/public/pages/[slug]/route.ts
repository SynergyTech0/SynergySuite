import { type Params, publicRoute } from "@/lib/api";
import { pageBySlug, publicPage } from "@/lib/pages";
import { UserError } from "@/lib/util";

export const dynamic = "force-dynamic";

export const GET = publicRoute(async (_req, { params }: Params<"slug">) => {
  const page = await pageBySlug((await params).slug);
  if (!page || !page.published) throw new UserError("Booking page not found", 404);
  return publicPage(page);
});
