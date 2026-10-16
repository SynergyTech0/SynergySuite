import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  createFile, createFileIn, createFolder, deleteFile, deleteFolder, folderPath, getFile, listFiles, listFolders, moveFile, readThumb, replaceFile, rootDir, setThumb,
} from "@/lib/store";
import { dxfLines, fitSegments, needsThumb } from "@/lib/thumbnail";

const bytes = (s: string) => new TextEncoder().encode(s);
const PNG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);

describe("folders", () => {
  beforeEach(async () => {
    process.env.CAD_DIR = await mkdtemp(path.join(os.tmpdir(), "cad-lib-"));
  });
  afterEach(async () => {
    await rm(rootDir(), { recursive: true, force: true });
  });

  it("keeps folder paths tidy and refuses ones that can't be folders", () => {
    expect(folderPath(" Projects / Site A/ ")).toBe("Projects/Site A");
    expect(folderPath("")).toBe("");
    expect(folderPath("a/../b")).toBeNull();
    expect(folderPath("x/".repeat(9))).toBeNull();
  });

  it("makes parents, files go in folders, and moves between them", async () => {
    expect(await createFolder("alice", "Projects/Site A")).toBe("Projects/Site A");
    expect(await listFolders("alice")).toEqual(["Projects", "Projects/Site A"]);
    expect(await listFolders("bob")).toEqual([]);
    const f = (await createFileIn("alice", "Projects/Site A", "plan.dxf", bytes("x")))!;
    expect(f.folder).toBe("Projects/Site A");
    expect(await createFileIn("alice", "Nope", "plan.dxf", bytes("x"))).toBeNull();
    expect(await createFileIn("bob", "Projects", "plan.dxf", bytes("x"))).toBeNull();
    expect((await moveFile("alice", f.id, "Projects"))!.folder).toBe("Projects");
    expect(await moveFile("alice", f.id, "Elsewhere")).toBeNull();
    expect((await moveFile("alice", f.id, ""))!.folder).toBeUndefined();
    expect(await moveFile("bob", f.id, "")).toBeNull();
  });

  it("keeps a file's folder across saves", async () => {
    await createFolder("alice", "A");
    const f = (await createFileIn("alice", "A", "plan.dxf", bytes("one")))!;
    await replaceFile("alice", f.id, bytes("two"));
    expect((await getFile("alice", f.id))!.folder).toBe("A");
  });

  it("removes only empty folders", async () => {
    await createFolder("alice", "A/B");
    expect(await deleteFolder("alice", "A")).toBe("not-empty");
    const f = (await createFileIn("alice", "A/B", "plan.dxf", bytes("x")))!;
    expect(await deleteFolder("alice", "A/B")).toBe("not-empty");
    await deleteFile("alice", f.id);
    expect(await deleteFolder("alice", "A/B")).toBe(true);
    expect(await deleteFolder("alice", "A")).toBe(true);
    expect(await deleteFolder("alice", "A")).toBe(false);
    expect(await listFiles("alice")).toEqual([]);
  });
});

describe("library pictures", () => {
  beforeEach(async () => {
    process.env.CAD_DIR = await mkdtemp(path.join(os.tmpdir(), "cad-thumb-"));
  });
  afterEach(async () => {
    await rm(rootDir(), { recursive: true, force: true });
  });

  it("stores a PNG for the owner only, and goes stale on the next save", async () => {
    const f = await createFile("alice", "plan.dxf", bytes("x"));
    expect(needsThumb(f)).toBe(true);
    expect(await setThumb("alice", f.id, bytes("<svg onload=alert(1)>"))).toBeNull();
    expect(await setThumb("bob", f.id, PNG)).toBeNull();
    const withThumb = (await setThumb("alice", f.id, PNG))!;
    expect(needsThumb(withThumb)).toBe(false);
    expect([...(await readThumb("alice", f.id))!]).toEqual([...PNG]);
    expect(await readThumb("bob", f.id)).toBeNull();
    await new Promise((r) => setTimeout(r, 5));
    expect(needsThumb((await replaceFile("alice", f.id, bytes("y")))!)).toBe(true);
    await deleteFile("alice", f.id);
    expect(await readThumb("alice", f.id)).toBeNull();
  });
});

const dxf = (entities: string, blocks = "") =>
  `0\nSECTION\n2\nBLOCKS\n${blocks}0\nENDSEC\n0\nSECTION\n2\nENTITIES\n${entities}0\nENDSEC\n0\nEOF\n`;

describe("dxfLines", () => {
  it("reads lines, polylines and circles", () => {
    const segs = dxfLines(dxf(
      "0\nLINE\n8\n0\n10\n0\n20\n0\n11\n10\n21\n0\n" +
      "0\nLWPOLYLINE\n8\n0\n90\n3\n70\n1\n10\n0\n20\n0\n10\n5\n20\n0\n10\n5\n20\n5\n" +
      "0\nCIRCLE\n8\n0\n10\n0\n20\n0\n40\n2\n",
    ));
    expect(segs[0]).toEqual([0, 0, 10, 0]);
    expect(segs.slice(1, 4)).toEqual([[0, 0, 5, 0], [5, 0, 5, 5], [5, 5, 0, 0]]);
    const circle = segs.slice(4);
    expect(circle.length).toBeGreaterThanOrEqual(8);
    expect(circle.every(([a, b]) => Math.abs(Math.hypot(a, b) - 2) < 1e-9)).toBe(true);
  });

  it("places block inserts with their base point, scale and rotation, and skips paper space", () => {
    const block = "0\nBLOCK\n8\n0\n2\nDOOR\n10\n1\n20\n0\n0\nLINE\n8\n0\n10\n1\n20\n0\n11\n2\n21\n0\n0\nENDBLK\n";
    const segs = dxfLines(dxf("0\nINSERT\n8\n0\n2\nDOOR\n10\n100\n20\n50\n41\n2\n42\n2\n50\n90\n0\nLINE\n67\n1\n8\n0\n10\n0\n20\n0\n11\n1\n21\n1\n", block));
    expect(segs).toHaveLength(1);
    const [a, b, c, d] = segs[0];
    expect([a, b, c, d].map((v) => Math.round(v * 1e9) / 1e9)).toEqual([100, 50, 100, 52]);
  });

  it("fits a drawing into the picture with y up, ignoring a far-off stray point", () => {
    const segs: [number, number, number, number][] = Array.from({ length: 400 }, (_, i) => [i, 0, i, 100]);
    segs.push([1e6, 1e6, 1e6, 1e6]);
    const fitted = fitSegments(segs, 320, 240, 10);
    const ys = fitted.slice(0, 400).flatMap(([, b, , d]) => [b, d]);
    expect(Math.min(...ys)).toBeGreaterThanOrEqual(9.9);
    expect(Math.max(...ys)).toBeLessThanOrEqual(230.1);
    expect(fitted[0][1]).toBeGreaterThan(fitted[0][3]); // y = 0 is drawn below y = 100
  });
});
