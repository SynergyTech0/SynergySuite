import { readFile } from "node:fs/promises";
import path from "node:path";
import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

// The Hunspell dictionary for spelling (dictionary-en: MIT and BSD), as text
// for nspell in the browser. GET ?lang=en -> { aff, dic }.
let cached: Promise<{ aff: string; dic: string }> | null = null;

async function load(): Promise<{ aff: string; dic: string }> {
  const roots = [path.join(process.cwd(), "node_modules"), path.join(process.cwd(), "..", "..", "node_modules")];
  for (const r of roots) {
    const dir = path.join(r, "dictionary-en");
    try {
      const [aff, dic] = await Promise.all([readFile(path.join(dir, "index.aff"), "utf8"), readFile(path.join(dir, "index.dic"), "utf8")]);
      return { aff, dic };
    } catch {
      // try the next place
    }
  }
  throw new Error("dictionary-en is not installed");
}

export async function GET(req: NextRequest) {
  const lang = req.nextUrl.searchParams.get("lang") || "en";
  if (lang !== "en") return NextResponse.json({ error: "only English is available" }, { status: 404 });
  try {
    cached ??= load();
    const d = await cached;
    return NextResponse.json(d, { headers: { "Cache-Control": "public, max-age=86400" } });
  } catch (e) {
    cached = null;
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
