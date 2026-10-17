import { NextResponse } from "next/server";
import { meInfo } from "@/lib/me";

/** Who is signed in and what they may do here. */
export async function GET(): Promise<Response> {
  const me = await meInfo();
  return me ? NextResponse.json(me) : NextResponse.json({ error: "Sign in required" }, { status: 401 });
}
