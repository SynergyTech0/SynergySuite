import { route } from "@/lib/api";
import { enrollmentFor } from "@/lib/mdm/apple";

/** An enrollment profile for an iPhone, iPad or Mac: yours, or the organization's (?org=1, admins). */
export const GET = route(async (me, req) => {
  const { filename, xml } = await enrollmentFor(me, new URL(req.url).searchParams.get("org") === "1");
  return new Response(xml, {
    headers: {
      "content-type": "application/x-apple-aspen-config",
      "content-disposition": `attachment; filename="${filename}"`,
      "cache-control": "no-store",
    },
  });
});
