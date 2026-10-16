import { NextResponse } from "next/server";
import { complianceAuthorized } from "@synergy/compliance";
import { UserError } from "@/lib/accounts";
import { exportItems, parseExportRequest } from "@/lib/discovery";

export const dynamic = "force-dynamic";

/** eDiscovery export for the Admin center (Bearer COMPLIANCE_TOKEN): each message as .eml plus its parts. */
export async function POST(req: Request): Promise<Response> {
  if (!complianceAuthorized(req.headers.get("authorization"))) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const body = await req.json().catch(() => {
      throw new UserError("Expected a JSON body");
    });
    return NextResponse.json({ items: await exportItems(parseExportRequest(body)) });
  } catch (err) {
    if (err instanceof UserError) return NextResponse.json({ error: err.message }, { status: err.status });
    console.error("[mail] compliance export", err);
    return NextResponse.json({ error: "Something went wrong" }, { status: 500 });
  }
}
