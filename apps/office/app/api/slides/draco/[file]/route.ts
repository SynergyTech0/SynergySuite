import { readFile } from "node:fs/promises";
import path from "node:path";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

// The Draco mesh decoder (Apache-2.0) that three.js ships, for 3D models whose
// meshes are Draco-compressed. Only these two files are served.
const FILES: Record<string, string> = {
  "draco_wasm_wrapper.js": "text/javascript; charset=utf-8",
  "draco_decoder.wasm": "application/wasm",
  "draco_decoder.js": "text/javascript; charset=utf-8",
};

export async function GET(_req: Request, ctx: { params: Promise<{ file: string }> }) {
  const { file } = await ctx.params;
  const type = FILES[file];
  if (!type) return NextResponse.json({ error: "not found" }, { status: 404 });
  for (const root of [path.join(process.cwd(), "node_modules"), path.join(process.cwd(), "..", "..", "node_modules")]) {
    try {
      const bytes = await readFile(path.join(root, "three", "examples", "jsm", "libs", "draco", "gltf", file));
      return new NextResponse(new Uint8Array(bytes), { headers: { "Content-Type": type, "Cache-Control": "public, max-age=604800", "X-Content-Type-Options": "nosniff" } });
    } catch {
      // try the next place
    }
  }
  return NextResponse.json({ error: "the decoder is not installed" }, { status: 500 });
}
