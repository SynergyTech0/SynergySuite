import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { MAX_COMMENTS, commentInput, sharedView } from "@/lib/share";
import {
  addComment, createFile, deleteFile, getFile, getShare, isOwner, openShare, readSharedBytes, removeComment, replaceFile, rootDir, shareFile, unshareFile,
} from "@/lib/store";

const bytes = (s: string) => new TextEncoder().encode(s);

describe("share links", () => {
  beforeEach(async () => {
    process.env.CAD_DIR = await mkdtemp(path.join(os.tmpdir(), "cad-share-"));
  });
  afterEach(async () => {
    await rm(rootDir(), { recursive: true, force: true });
  });

  it("opens a shared file by its token, and only its owner can share it", async () => {
    const f = await createFile("alice", "plan.dxf", bytes("drawing"));
    expect(await shareFile("bob", f.id)).toBeNull();
    const share = (await shareFile("alice", f.id))!;
    expect(share.token).toMatch(/^[0-9a-f]{32}$/);
    expect((await shareFile("alice", f.id))!.token).toBe(share.token); // sharing again keeps the link
    expect((await getFile("alice", f.id))!.shared).toBe(share.token);
    const shared = (await readSharedBytes(share.token))!;
    expect(shared.file.name).toBe("plan.dxf");
    expect(shared.bytes.toString()).toBe("drawing");
    expect(isOwner(share, "alice")).toBe(true);
    expect(isOwner(share, "bob")).toBe(false);
  });

  it("keeps the link working across saves and kills it when sharing stops or the file goes", async () => {
    const f = await createFile("alice", "plan.dxf", bytes("one"));
    const { token } = (await shareFile("alice", f.id))!;
    await replaceFile("alice", f.id, bytes("two"));
    expect((await readSharedBytes(token))!.bytes.toString()).toBe("two");
    expect(await unshareFile("alice", f.id)).toBe(true);
    expect(await openShare(token)).toBeNull();
    expect(await getShare("alice", f.id)).toBeNull();
    const again = (await shareFile("alice", f.id))!;
    expect(again.token).not.toBe(token); // a new link, not the old one back
    await deleteFile("alice", f.id);
    expect(await openShare(again.token)).toBeNull();
  });

  it("refuses tokens that aren't ours", async () => {
    expect(await openShare("../../etc/passwd")).toBeNull();
    expect(await openShare("0".repeat(32))).toBeNull();
    expect(await addComment("0".repeat(32), "x", true, "hi")).toBeNull();
  });

  it("collects comments, including several posted at once, and lets only the owner remove them", async () => {
    const f = await createFile("alice", "bracket.step", bytes("model"));
    const { token } = (await shareFile("alice", f.id))!;
    await Promise.all(Array.from({ length: 10 }, (_, i) => addComment(token, `Guest ${i}`, true, `note ${i}`)));
    const { share } = (await openShare(token))!;
    expect(share.comments).toHaveLength(10);
    const first = share.comments[0];
    expect(await removeComment(token, "bob", first.id)).toBe(false);
    expect(await removeComment(token, "alice", first.id)).toBe(true);
    expect((await openShare(token))!.share.comments).toHaveLength(9);
    const view = sharedView((await openShare(token))!.file, (await openShare(token))!.share, false);
    expect(view).toMatchObject({ name: "bracket.step", editor: "model", owner: false });
    expect(Object.keys(view)).not.toContain("id");
  });

  it("stops taking comments when a share is full", async () => {
    const f = await createFile("alice", "plan.dxf", bytes("x"));
    const { token } = (await shareFile("alice", f.id))!;
    for (let i = 0; i < MAX_COMMENTS; i++) await addComment(token, "a", true, "b");
    expect(await addComment(token, "a", true, "one more")).toBe("full");
  });
});

describe("commentInput", () => {
  it("uses the signed-in name over any name sent, and Guest when there's none", () => {
    expect(commentInput({ text: " hi ", name: "Mallory" }, "Alice")).toEqual({ author: "Alice", text: "hi" });
    expect(commentInput({ text: "hi", name: "  Pat\u0007 " }, null)).toEqual({ author: "Pat", text: "hi" });
    expect(commentInput({ text: "hi" }, null)).toEqual({ author: "Guest", text: "hi" });
  });

  it("rejects empty and oversized comments", () => {
    expect(commentInput({ text: "   " }, null)).toHaveProperty("error");
    expect(commentInput(null, null)).toHaveProperty("error");
    expect(commentInput({ text: "x".repeat(2001) }, null)).toHaveProperty("error");
  });
});
