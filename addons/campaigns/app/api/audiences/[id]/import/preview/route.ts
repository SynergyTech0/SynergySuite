import { body, route } from "@/lib/api";
import { previewSource } from "@/lib/sources";

/** How many people a CRM or Contacts import would bring, with a few of them. */
export const POST = route(async (ctx, req) => {
  const b = await body<{ kind?: string; params?: unknown }>(req);
  return previewSource(ctx, b.kind, b.params);
});
