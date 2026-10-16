import { NextResponse } from "next/server";
import { fail } from "@/lib/api";
import { providerAuthorized } from "@/lib/checkout";
import { onlinePaid } from "@/lib/sales";

/** The payment provider's callback (Bearer COMMERCE_CHECKOUT_TOKEN); see lib/checkout.ts. */
export async function POST(req: Request): Promise<Response> {
  if (!providerAuthorized(req.headers.get("authorization"))) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    return NextResponse.json(await onlinePaid(await req.json()));
  } catch (err) {
    return fail(err);
  }
}
