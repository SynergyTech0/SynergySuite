import { NextResponse } from "next/server";
import { publicRoute } from "@/lib/api";
import { publicPage } from "@/lib/public";

export const dynamic = "force-dynamic";

/** The public status page as JSON, for embedding elsewhere. Anyone may read it. */
export const GET = publicRoute(async () =>
  NextResponse.json(await publicPage(), { headers: { "cache-control": "public, max-age=30", "access-control-allow-origin": "*" } }),
);
