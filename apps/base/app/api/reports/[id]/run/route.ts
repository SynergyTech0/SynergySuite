import { route } from "@/lib/http";
import { runReport } from "@/lib/reports";

/** POST `{ layout? }` lays out the report's records; a layout previews an unsaved design. */
export const POST = route<{ id: string }>(async (req, me, { id }) => {
  const b = (await req.json().catch(() => ({}))) as { layout?: unknown };
  return { report: await runReport(id, me.email, b?.layout) };
});
