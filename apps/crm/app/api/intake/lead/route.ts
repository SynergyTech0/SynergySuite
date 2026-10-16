import { NextResponse } from "next/server";
import { fail } from "@/lib/api";
import { readIntake, receiveLead, tokenOk } from "@/lib/intake";

/**
 * Web-to-lead. Public (no suite sign-in, no same-origin check): a website's backend posts here
 * with Bearer CRM_API_TOKEN. With no token configured the endpoint answers 404.
 */
export async function POST(req: Request): Promise<Response> {
  try {
    if (!process.env.CRM_API_TOKEN) return NextResponse.json({ error: "Not found" }, { status: 404 });
    if (!tokenOk(req.headers.get("authorization"))) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers: { "WWW-Authenticate": "Bearer" } });
    }
    const id = await receiveLead(await readIntake(req));
    return NextResponse.json({ id }, { status: 201 });
  } catch (err) {
    return fail(err);
  }
}
