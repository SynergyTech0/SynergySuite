import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { existsSync } from "node:fs";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { db } from "@/db";
import { attachments, boardMembers } from "@/db/schema";
import { closeDb, resetDb } from "../helpers/db";
import { seedTenant, type Tenant } from "../helpers/seed";
import { safeName, servedType } from "@/lib/attachment-store";

/**
 * FAILING-FIRST for uploaded files.
 *
 * An upload is the only place a user's bytes are stored and handed back to other users' browsers, so
 * these tests are mostly about what must NOT happen: a filename that escapes the storage directory,
 * an HTML file served as HTML, a file readable by someone who cannot see the card, or an orphan left
 * on disk after the attachment is deleted.
 */

const identity = { sub: "", email: "" };
vi.mock("next/headers", () => ({
  headers: async () => new Headers({ "x-forwarded-user": identity.sub, "x-forwarded-email": identity.email }),
}));
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });

let alice: Tenant;

beforeEach(async () => {
  process.env.ATTACHMENT_DIR = await mkdtemp(path.join(tmpdir(), "sboards-att-"));
  await resetDb();
  alice = await seedTenant("alice");
  identity.sub = alice.sub; identity.email = alice.email;
});
afterAll(async () => { await closeDb(); });

function upload(cardId: string, file: { name: string; type: string; body: BlobPart }) {
  const form = new FormData();
  form.set("cardId", cardId);
  form.set("file", new File([file.body], file.name, { type: file.type }));
  return new Request("http://localhost/api/attachments/upload", { method: "POST", body: form });
}

describe("uploading a file", () => {
  it("stores the bytes, records the attachment and serves them back", async () => {
    const { POST } = await import("@/app/api/attachments/upload/route");
    const res = await POST(upload(alice.cardId, { name: "notes.txt", type: "text/plain", body: "hello there" }));
    expect(res.status).toBe(201);
    const att = await res.json();
    expect(att).toMatchObject({ name: "notes.txt", cardId: alice.cardId });
    expect(att.sizeBytes).toBe(11);
    expect(att.url).toBeNull();                        // an uploaded file is not a link

    const { GET } = await import("@/app/api/attachments/[id]/file/route");
    const file = await GET(new Request("http://localhost"), ctx(att.id));
    expect(file.status).toBe(200);
    expect(await file.text()).toBe("hello there");
  });

  it("never lets the client's filename choose where the file lands", async () => {
    const { POST } = await import("@/app/api/attachments/upload/route");
    const res = await POST(upload(alice.cardId, { name: "../../../etc/passwd", type: "text/plain", body: "x" }));
    expect(res.status).toBe(201);
    const att = await res.json();
    // The stored key is ours, not theirs, and the displayed name has no path left in it.
    expect(att.storageKey).not.toContain("..");
    expect(att.storageKey).not.toContain("/");
    expect(att.name).toBe("passwd");
    const dir = process.env.ATTACHMENT_DIR!;
    expect(existsSync(path.join(dir, att.storageKey))).toBe(true);
  });

  it("serves an uploaded HTML file as a download, never as a page", async () => {
    const { POST } = await import("@/app/api/attachments/upload/route");
    const att = await (await POST(upload(alice.cardId, {
      name: "evil.html", type: "text/html", body: "<script>alert(document.cookie)</script>",
    }))).json();

    const { GET } = await import("@/app/api/attachments/[id]/file/route");
    const file = await GET(new Request("http://localhost"), ctx(att.id));
    expect(file.headers.get("content-type")).toBe("application/octet-stream");
    expect(file.headers.get("content-disposition")).toContain("attachment");
    expect(file.headers.get("x-content-type-options")).toBe("nosniff");
  });

  it("shows an image inline, so it can be a card cover", async () => {
    const { POST } = await import("@/app/api/attachments/upload/route");
    const att = await (await POST(upload(alice.cardId, {
      name: "shot.png", type: "image/png", body: new Uint8Array([0x89, 0x50, 0x4e, 0x47]).buffer,
    }))).json();
    const { GET } = await import("@/app/api/attachments/[id]/file/route");
    const file = await GET(new Request("http://localhost"), ctx(att.id));
    expect(file.headers.get("content-type")).toBe("image/png");
    expect(file.headers.get("content-disposition")).toContain("inline");
  });

  it("refuses a file larger than the limit rather than filling the disk", async () => {
    const { POST } = await import("@/app/api/attachments/upload/route");
    const big = new ArrayBuffer(10 * 1024 * 1024 + 1);
    expect((await POST(upload(alice.cardId, { name: "big.bin", type: "application/octet-stream", body: big }))).status)
      .toBe(413);
  });

  it("refuses an empty upload, and one with no card", async () => {
    const { POST } = await import("@/app/api/attachments/upload/route");
    expect((await POST(upload(alice.cardId, { name: "empty.txt", type: "text/plain", body: "" }))).status).toBe(400);
    const form = new FormData();
    form.set("file", new File(["x"], "x.txt", { type: "text/plain" }));
    expect((await POST(new Request("http://localhost", { method: "POST", body: form }))).status).toBe(404);
  });
});

describe("who may upload and read", () => {
  it("another tenant can neither upload to the card nor read the file", async () => {
    const { POST } = await import("@/app/api/attachments/upload/route");
    const att = await (await POST(upload(alice.cardId, { name: "secret.txt", type: "text/plain", body: "ours" }))).json();

    const bob = await seedTenant("bob");
    identity.sub = bob.sub; identity.email = bob.email;
    expect((await POST(upload(alice.cardId, { name: "theirs.txt", type: "text/plain", body: "x" }))).status).toBe(404);
    const { GET } = await import("@/app/api/attachments/[id]/file/route");
    expect((await GET(new Request("http://localhost"), ctx(att.id))).status).toBe(404);
  });

  it("an observer may read the file but not upload one", async () => {
    const { POST } = await import("@/app/api/attachments/upload/route");
    const att = await (await POST(upload(alice.cardId, { name: "readme.txt", type: "text/plain", body: "ours" }))).json();

    const carol = await seedTenant("carol");
    await db.insert(boardMembers).values({ boardId: alice.boardId, userId: carol.userId, role: "observer" });
    identity.sub = carol.sub; identity.email = carol.email;

    expect((await POST(upload(alice.cardId, { name: "nope.txt", type: "text/plain", body: "x" }))).status).toBe(403);
    const { GET } = await import("@/app/api/attachments/[id]/file/route");
    expect((await GET(new Request("http://localhost"), ctx(att.id))).status).toBe(200);
  });
});

describe("deleting", () => {
  it("takes the file off disk with the row, leaving no orphan", async () => {
    const { POST } = await import("@/app/api/attachments/upload/route");
    const att = await (await POST(upload(alice.cardId, { name: "bye.txt", type: "text/plain", body: "bye" }))).json();
    const onDisk = path.join(process.env.ATTACHMENT_DIR!, att.storageKey);
    expect(existsSync(onDisk)).toBe(true);

    const { DELETE } = await import("@/app/api/attachments/[id]/route");
    expect((await DELETE(new Request("http://localhost", { method: "DELETE" }), ctx(att.id))).status).toBe(200);
    expect(await db.select().from(attachments).where(eq(attachments.id, att.id))).toHaveLength(0);
    expect(existsSync(onDisk)).toBe(false);
  });
});

describe("the naming and typing rules, on their own", () => {
  it("safeName keeps something readable and loses anything path-like", () => {
    expect(safeName("../../etc/passwd")).toBe("passwd");
    expect(safeName("C:\\Users\\shane\\report.xlsx")).toBe("report.xlsx");
    expect(safeName("  ")).toBe("file");
    expect(safeName("a".repeat(300)).length).toBeLessThanOrEqual(200);
  });

  it("servedType only ever hands back a type from the allow-list", () => {
    expect(servedType("image/png")).toEqual({ type: "image/png", disposition: "inline" });
    expect(servedType("application/pdf")).toEqual({ type: "application/pdf", disposition: "inline" });
    expect(servedType("text/html")).toEqual({ type: "application/octet-stream", disposition: "attachment" });
    expect(servedType("image/svg+xml")).toEqual({ type: "application/octet-stream", disposition: "attachment" });
    expect(servedType(null)).toEqual({ type: "application/octet-stream", disposition: "attachment" });
  });
});
