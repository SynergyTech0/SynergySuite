// Serves the HiGHS solver (MIT, WebAssembly) to the browser for Data > Solver.
// It's loaded only when someone solves a model, so it isn't in the app bundle.
import { readFile } from "fs/promises";
import path from "path";

const FILES: Record<string, string> = {
  "highs.mjs": "text/javascript; charset=utf-8",
  "highs.wasm": "application/wasm",
};

// The package sits in the app's node_modules or, in the workspace, the root one.
const ROOTS = [path.join(process.cwd(), "node_modules/highs/build"), path.join(process.cwd(), "../../node_modules/highs/build")];

export async function GET(_req: Request, { params }: { params: Promise<{ file: string }> }) {
  const { file } = await params;
  const type = FILES[file];
  if (!type) return new Response("Not found", { status: 404 });
  for (const root of ROOTS) {
    try {
      const body = await readFile(path.join(root, file));
      return new Response(new Uint8Array(body), { headers: { "content-type": type, "cache-control": "public, max-age=86400" } });
    } catch {
      /* try the next place */
    }
  }
  return new Response("Not found", { status: 404 });
}
