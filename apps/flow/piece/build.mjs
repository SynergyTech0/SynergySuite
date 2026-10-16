// Builds the Synergy piece into one self-contained bundle and packs it, the form the flow engine
// installs custom pieces in (no dependencies to fetch at install time). Flow uploads the result
// to the engine on start; bump PIECE_VERSION whenever the piece changes so the engine takes it.
import { build } from "esbuild";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ACTIVEPIECES_MIT = `Copyright (c) 2020-2024 Activepieces Inc.

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.`;

export const PIECE_NAME = "@synergy/piece-synergy";
export const PIECE_VERSION = "0.1.0";

const here = dirname(fileURLToPath(import.meta.url));
const out = join(here, "dist");
const pkg = join(out, "package");
rmSync(out, { recursive: true, force: true });
mkdirSync(join(pkg, "src"), { recursive: true });

const result = await build({
  entryPoints: [join(here, "src/index.ts")],
  outfile: join(pkg, "src/index.js"),
  bundle: true,
  platform: "node",
  format: "cjs",
  target: "node20",
  minify: true,
  // The engine finds the piece by its class name (Piece), so names must survive minifying.
  keepNames: true,
  legalComments: "none",
  logLevel: "warning",
  metafile: true,
});

writeFileSync(join(pkg, "THIRD_PARTY_NOTICES.txt"), notices(result.metafile));

writeFileSync(
  join(pkg, "package.json"),
  JSON.stringify({ name: PIECE_NAME, version: PIECE_VERSION, main: "./src/index.js", license: "AGPL-3.0-only", dependencies: {}, files: ["src", "THIRD_PARTY_NOTICES.txt"] }, null, 2) + "\n",
);
execFileSync("npm", ["pack", "--silent", "--pack-destination", out], { cwd: pkg, stdio: ["ignore", "ignore", "inherit"] });
const tgz = readdirSync(out).find((f) => f.endsWith(".tgz"));
renameSync(join(out, tgz), join(out, "synergy-piece.tgz"));
writeFileSync(join(out, "piece.json"), JSON.stringify({ name: PIECE_NAME, version: PIECE_VERSION }) + "\n");
console.log(`Built ${PIECE_NAME}@${PIECE_VERSION} -> piece/dist/synergy-piece.tgz`);

/**
 * The licenses of every package inlined into the bundle. The Activepieces framework packages
 * carry no license file on npm; the Activepieces repository licenses them MIT (everything outside
 * its ee folders), so that text is included for them.
 */
function notices(metafile) {
  const pkgs = new Map();
  for (const input of Object.keys(metafile.inputs)) {
    const m = input.match(/(?:^|\/)node_modules\/((?:@[^/]+\/)?[^/]+)\//g);
    if (!m) continue;
    const last = m[m.length - 1];
    const dir = input.slice(0, input.lastIndexOf(last) + last.length);
    const name = last.replace(/^\/?node_modules\//, "").replace(/\/$/, "");
    if (!pkgs.has(name)) pkgs.set(name, join(process.cwd(), dir));
  }
  const out = ["Third-party software bundled into the Synergy piece for Synergy Flow.", ""];
  for (const [name, dir] of [...pkgs].sort(([a], [b]) => a.localeCompare(b))) {
    let meta = {};
    try {
      meta = JSON.parse(readFileSync(join(dir, "package.json"), "utf8"));
    } catch {}
    const file = existsSync(dir) ? readdirSync(dir).find((f) => /^(licen[cs]e|copying)(\.|$)/i.test(f)) : undefined;
    let body = file ? readFileSync(join(dir, file), "utf8").trim() : "";
    if (!body && name.startsWith("@activepieces/")) body = ACTIVEPIECES_MIT;
    out.push("=".repeat(72), `${name}@${meta.version ?? "?"} (${meta.license ?? (name.startsWith("@activepieces/") ? "MIT" : "see package")})`, "", body || "(no license file in the package)", "");
  }
  return out.join("\n");
}
