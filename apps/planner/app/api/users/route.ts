import { NextResponse } from "next/server";
import { db } from "@/db";
import { users } from "@/db/schema";
import { inArray } from "drizzle-orm";
import { getCurrentUserOrNull } from "@/lib/session";
import { notFound, workspacePeerIds } from "@/lib/authz";

// Assignable users: everyone who shares a workspace with the caller, never the whole users table.
// This route used to seed two hardcoded dev users on every GET — a write inside a read, and in a
// multi-tenant product it also put strangers into every other tenant's assignee picker.
export async function GET() {
  const user = await getCurrentUserOrNull();
  if (!user) return notFound();
  const ids = await workspacePeerIds(user.id);
  if (!ids.length) return NextResponse.json([]);
  const all = await db.select().from(users).where(inArray(users.id, ids));
  // isMe lets a client offer "my issues" without a second request for the caller's identity.
  return NextResponse.json(all.map((u) => ({ id: u.id, name: u.name, isMind: u.isMind, isMe: u.id === user.id })));
}
