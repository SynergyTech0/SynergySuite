import { NextResponse } from "next/server";
import { currentUser } from "@/lib/session";
import { assistantSettings } from "@/lib/ai";

/** Whether the 3D modeling assistant is on, and how the editor reaches it (lib/ai.ts). */
export async function GET() {
  if (!(await currentUser())) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  return NextResponse.json(await assistantSettings());
}
