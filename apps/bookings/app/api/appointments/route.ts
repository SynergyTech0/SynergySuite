import { body, route } from "@/lib/api";
import { type BookInput, bookForCustomer, list } from "@/lib/appointments";

/** Appointments on the person's pages: ?page=&from=&to=&mine=1&status=&q= */
export const GET = route(async (me, req) => {
  const u = new URL(req.url).searchParams;
  return list(me, { pageId: u.get("page"), from: u.get("from"), to: u.get("to"), mine: u.get("mine") === "1", status: u.get("status"), q: u.get("q") });
});

/** Staff book on a customer's behalf. */
export const POST = route(async (me, req) => bookForCustomer(me, await body<BookInput & { pageId?: string; staffEmail?: string }>(req)));
