import { type Params, vroute } from "@/lib/api";
import { depositFile, depositPreview } from "@/lib/payroll/deposit";

/** ?download=1 for the NACHA file itself; otherwise who's in it and what's missing. */
export const GET = vroute(async (v, req, { params }: Params<"id">) => {
  const { id } = await params;
  if (!new URL(req.url).searchParams.get("download")) return depositPreview(v, id);
  const f = await depositFile(v, id);
  return new Response(f.text, {
    headers: {
      "content-type": "text/plain; charset=us-ascii",
      "content-disposition": `attachment; filename="${f.filename}"`,
      "cache-control": "no-store",
    },
  });
});
