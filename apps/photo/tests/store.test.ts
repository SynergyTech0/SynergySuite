import { mkdtemp, readdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createFile, deleteFile, getFile, inlineType, listFiles, readBytes, replaceFile, rootDir, safeName } from "@/lib/store";

const bytes = (s: string) => new TextEncoder().encode(s);

describe("photo store", () => {
  beforeEach(async () => {
    process.env.PHOTO_DIR = await mkdtemp(path.join(os.tmpdir(), "photo-"));
  });
  afterEach(async () => {
    await rm(rootDir(), { recursive: true, force: true });
  });

  it("keeps each user's files apart", async () => {
    const a = await createFile("alice", "cat.png", bytes("a"));
    await createFile("bob", "dog.png", bytes("b"));
    expect((await listFiles("alice")).map((f) => f.name)).toEqual(["cat.png"]);
    expect(await getFile("bob", a.id)).toBeNull();
    expect(await readBytes("bob", a.id)).toBeNull();
  });

  it("replaces bytes on save and keeps the previous version", async () => {
    const f = await createFile("alice", "cat.psd", bytes("one"));
    const saved = await replaceFile("alice", f.id, bytes("two!"));
    expect(saved?.size).toBe(4);
    expect((await readBytes("alice", f.id))?.toString()).toBe("two!");
    const [dir] = await readdir(rootDir());
    expect((await readdir(path.join(rootDir(), dir))).sort()).toEqual([`${f.id}.bin`, `${f.id}.json`, `${f.id}.prev`]);
  });

  it("refuses ids it didn't generate", async () => {
    expect(await readBytes("alice", "../../etc/passwd")).toBeNull();
    expect(await replaceFile("alice", "0".repeat(32), bytes("x"))).toBeNull();
  });

  it("deletes a file and its previous version", async () => {
    const f = await createFile("alice", "cat.png", bytes("a"));
    await replaceFile("alice", f.id, bytes("b"));
    expect(await deleteFile("alice", f.id)).toBe(true);
    expect(await listFiles("alice")).toEqual([]);
  });

  it("treats names as labels, never paths", () => {
    expect(safeName("../../evil/..hidden.png")).toBe("hidden.png");
    expect(safeName("")).toBe("image");
  });

  it("serves only plain image types inline", () => {
    expect(inlineType("a.JPG")).toBe("image/jpeg");
    expect(inlineType("a.svg")).toBeNull();
    expect(inlineType("a.psd")).toBeNull();
  });
});
