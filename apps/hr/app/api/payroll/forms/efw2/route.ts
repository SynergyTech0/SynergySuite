import { vroute } from "@/lib/api";
import { efw2File } from "@/lib/payroll/yearend";

export const GET = vroute(async (v, req) => {
  const f = await efw2File(v, new URL(req.url).searchParams.get("year"));
  return new Response(f.text, {
    headers: { "content-type": "text/plain; charset=us-ascii", "content-disposition": `attachment; filename="${f.filename}"`, "cache-control": "no-store" },
  });
});
