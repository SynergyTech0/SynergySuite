import { NextResponse } from "next/server";
import { applySignEvent } from "@/lib/sign";

/** Signature progress from the signing service (x-service-token: CONTRACTS_SIGN_TOKEN). */
export async function POST(req: Request): Promise<Response> {
  const b = await req.json().catch(() => null);
  try {
    const out = await applySignEvent(req.headers.get("x-service-token"), b ?? {});
    return NextResponse.json(out.json, { status: out.status });
  } catch (err) {
    console.error("[contracts] sign event", err);
    return NextResponse.json({ error: "Something went wrong" }, { status: 500 });
  }
}
