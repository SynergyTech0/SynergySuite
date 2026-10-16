import { type Params, clientIp, publicRoute } from "@/lib/api";
import { availability } from "@/lib/appointments";
import { pageBySlug } from "@/lib/pages";
import { limit } from "@/lib/ratelimit";
import { UserError } from "@/lib/util";

export const dynamic = "force-dynamic";

/** Free times: ?service=&staff=&from=YYYY-MM-DD&to=YYYY-MM-DD, days in the page's time zone. */
export const GET = publicRoute(async (req, { params }: Params<"slug">) => {
  limit(`slots:${clientIp(req)}`, 120, 60_000);
  const u = new URL(req.url).searchParams;
  const page = await pageBySlug((await params).slug);
  if (!page || !page.published) throw new UserError("Booking page not found", 404);
  const service = page.services.find((s) => s.id === u.get("service") && s.active);
  if (!service) throw new UserError("Service not found", 404);
  const slots = await availability(page, service, u.get("from") ?? "", u.get("to") ?? "", { staffId: page.chooseStaff ? u.get("staff") : null });
  return page.chooseStaff ? slots : slots.map((s) => ({ start: s.start, staffIds: [] }));
});
