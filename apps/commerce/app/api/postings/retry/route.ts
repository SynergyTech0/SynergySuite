import { route } from "@/lib/api";
import { booksConfigured, flush } from "@/lib/books";
import { assertManager } from "@/lib/members";
import { UserError } from "@/lib/util";

/** Sends everything waiting to Books now, failed entries included. */
export const POST = route(async (ctx) => {
  assertManager(ctx);
  if (!booksConfigured()) throw new UserError("Books isn't connected: set BOOKS_INTERNAL_URL and BOOKS_SVC_TOKEN");
  return { sent: await flush({ force: true }) };
});
