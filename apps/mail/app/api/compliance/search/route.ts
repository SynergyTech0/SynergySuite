import { NextResponse } from "next/server";
import { complianceAuthorized } from "@synergy/compliance";
import { UserError } from "@/lib/accounts";
import { parseSearchRequest } from "@/lib/compliance";
import { search } from "@/lib/discovery";

export const dynamic = "force-dynamic";

/** eDiscovery search for the Admin center (Bearer COMPLIANCE_TOKEN), over suite mailboxes, outside accounts and the preserved store. */
export async function POST(req: Request): Promise<Response> {
  if (!complianceAuthorized(req.headers.get("authorization"))) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const body = await req.json().catch(() => {
      throw new UserError("Expected a JSON body");
    });
    return NextResponse.json(await search(parseSearchRequest(body)));
  } catch (err) {
    if (err instanceof UserError) return NextResponse.json({ error: err.message }, { status: err.status });
    console.error("[mail] compliance search", err);
    return NextResponse.json({ error: "Something went wrong" }, { status: 500 });
  }
}
