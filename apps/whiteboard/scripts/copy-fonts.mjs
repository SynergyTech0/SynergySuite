// Copies Excalidraw's hand-drawn and CJK fonts into public/fonts, so the canvas loads them from
// this server (window.EXCALIDRAW_ASSET_PATH = "/") instead of a public CDN.
import { cpSync, existsSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";

const require = createRequire(import.meta.url);
// The package's main entry is dist/prod/index.js; its fonts sit beside it.
const from = path.join(path.dirname(require.resolve("@excalidraw/excalidraw")), "fonts");
const to = path.join(import.meta.dirname, "..", "public", "fonts");
if (!existsSync(from)) {
  console.error(`No fonts at ${from}; is @excalidraw/excalidraw installed?`);
  process.exit(1);
}
cpSync(from, to, { recursive: true });
console.log(`Copied Excalidraw fonts to ${to}`);
