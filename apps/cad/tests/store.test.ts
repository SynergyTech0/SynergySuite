import { mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  createFile, deleteFile, getFile, inlineType, listFiles, listVersions, readBytes, readVersion, replaceFile, restoreVersion, rootDir, safeName,
} from "@/lib/store";

const bytes = (s: string) => new TextEncoder().encode(s);

describe("cad store", () => {
  beforeEach(async () => {
    process.env.CAD_DIR = await mkdtemp(path.join(os.tmpdir(), "cad-"));
  });
  afterEach(async () => {
    await rm(rootDir(), { recursive: true, force: true });
  });

  it("keeps each user's files apart", async () => {
    const a = await createFile("alice", "plan.dxf", bytes("a"));
    await createFile("bob", "site.dwg", bytes("b"));
    expect((await listFiles("alice")).map((f) => f.name)).toEqual(["plan.dxf"]);
    expect(await getFile("bob", a.id)).toBeNull();
    expect(await readBytes("bob", a.id)).toBeNull();
  });

  it("replaces bytes on save and keeps the previous version", async () => {
    const f = await createFile("alice", "plan.dwg", bytes("one"));
    const saved = await replaceFile("alice", f.id, bytes("two!"));
    expect(saved?.size).toBe(4);
    expect((await readBytes("alice", f.id))?.toString()).toBe("two!");
    expect(await listVersions("alice", f.id)).toEqual([{ n: 1, size: 3, saved: f.modified }]);
    expect((await readVersion("alice", f.id, 1))?.toString()).toBe("one");
  });

  it("keeps every save as a version, newest first, up to the limit", async () => {
    process.env.CAD_VERSIONS = "3";
    try {
      const f = await createFile("alice", "plan.dxf", bytes("v0"));
      for (let i = 1; i <= 5; i++) await replaceFile("alice", f.id, bytes(`v${i}`));
      const versions = (await listVersions("alice", f.id))!;
      expect(versions.map((v) => v.n)).toEqual([5, 4, 3]);
      expect((await readVersion("alice", f.id, 3))?.toString()).toBe("v2");
      expect(await readVersion("alice", f.id, 1)).toBeNull(); // dropped
      expect(await listVersions("bob", f.id)).toBeNull();
      expect(await readVersion("bob", f.id, 5)).toBeNull();
    } finally {
      delete process.env.CAD_VERSIONS;
    }
  });

  it("restores a version, keeping what it replaces", async () => {
    const f = await createFile("alice", "plan.dxf", bytes("first"));
    await replaceFile("alice", f.id, bytes("second"));
    const restored = (await restoreVersion("alice", f.id, 1))!;
    expect(restored.size).toBe(5);
    expect((await readBytes("alice", f.id))?.toString()).toBe("first");
    const versions = (await listVersions("alice", f.id))!;
    expect(versions.map((v) => v.n)).toEqual([2, 1]);
    expect((await readVersion("alice", f.id, 2))?.toString()).toBe("second");
    expect(await restoreVersion("alice", f.id, 9)).toBeNull();
  });

  it("takes in the one previous version older saves kept", async () => {
    const f = await createFile("alice", "plan.dxf", bytes("now"));
    const [dir] = await readdir(rootDir());
    await writeFile(path.join(rootDir(), dir, `${f.id}.prev`), "before");
    expect((await listVersions("alice", f.id))!.map((v) => v.size)).toEqual([6]);
    await replaceFile("alice", f.id, bytes("next"));
    expect((await listVersions("alice", f.id))!.map((v) => v.n)).toEqual([2, 1]);
    expect((await readVersion("alice", f.id, 1))?.toString()).toBe("before");
    expect((await readVersion("alice", f.id, 2))?.toString()).toBe("now");
  });

  it("refuses ids it didn't generate", async () => {
    expect(await readBytes("alice", "../../etc/passwd")).toBeNull();
    expect(await replaceFile("alice", "0".repeat(32), bytes("x"))).toBeNull();
  });

  it("deletes a file and its versions", async () => {
    const f = await createFile("alice", "plan.dxf", bytes("a"));
    await replaceFile("alice", f.id, bytes("b"));
    expect(await deleteFile("alice", f.id)).toBe(true);
    expect(await listFiles("alice")).toEqual([]);
    const [dir] = await readdir(rootDir());
    expect(await readdir(path.join(rootDir(), dir))).toEqual([]);
  });

  it("treats names as labels, never paths", () => {
    expect(safeName("../../evil/..hidden.dxf")).toBe("hidden.dxf");
    expect(safeName("")).toBe("drawing");
  });

  it("serves only plain image types inline", () => {
    expect(inlineType("a.JPG")).toBe("image/jpeg");
    expect(inlineType("a.svg")).toBeNull();
    expect(inlineType("a.psd")).toBeNull();
    expect(inlineType("a.dwg")).toBeNull();
  });
});
