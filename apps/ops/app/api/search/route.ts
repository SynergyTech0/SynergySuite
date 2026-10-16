import { NextResponse } from "next/server";
import { SearchInputError } from "@synergy/search";
import { route } from "@/lib/api";
import { searchFor } from "@/lib/search";

/** Suite-wide search for the signed-in person (the Search app calls it with their gateway headers). */
export const POST = route(async (me, req) => {
  let body: unknown = {};
  try {
    body = await req.json();
  } catch {
    body = {};
  }
  try {
    return await searchFor(me, body);
  } catch (e) {
    if (e instanceof SearchInputError) return NextResponse.json({ error: e.message }, { status: 400 });
    throw e;
  }
});
