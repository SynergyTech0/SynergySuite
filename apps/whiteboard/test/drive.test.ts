import { describe, expect, it } from "vitest";
import { driveHeaders, fileName, readFromDrive, saveToDrive } from "../lib/drive";
import { parseExcalidraw, toExcalidrawFile } from "../lib/ydoc";

const me = { email: "alice@example.com", name: "Alice" };

describe("Drive link", () => {
  it("calls Drive as the signed-in person, with the gateway secret", () => {
    process.env.PROXY_SHARED_SECRET = "s3cret";
    expect(driveHeaders(me)).toEqual({
      "x-auth-request-email": "alice@example.com",
      "x-auth-request-preferred-username": "Alice",
      "x-auth-request-user": "alice@example.com",
      "x-proxy-auth-secret": "s3cret",
    });
    delete process.env.PROXY_SHARED_SECRET;
  });

  it("makes file names Drive accepts", () => {
    expect(fileName('Q3: plan / "draft"?', "png")).toBe("Q3- plan - -draft-.png");
    expect(fileName("  ...  ", "svg")).toBe("Whiteboard.svg");
  });

  it("saves into the Whiteboards folder and links to the file in Drive", async () => {
    let seen: { url: string; init: RequestInit } | null = null;
    const f = (async (url: string, init: RequestInit) => {
      seen = { url, init };
      return new Response(JSON.stringify({ id: "11111111-1111-1111-1111-111111111111", name: "Plan.png", parentId: "22222222-2222-2222-2222-222222222222", size: 3, mime: "image/png" }));
    }) as unknown as typeof fetch;
    const out = await saveToDrive(me, "Plan.png", new Uint8Array([1, 2, 3]), "image/png", f);
    expect(seen!.url).toBe("http://localhost:3180/api/upload?path=Whiteboards%2FPlan.png");
    expect(seen!.init.method).toBe("PUT");
    expect(out.url).toBe("http://localhost:3180/?parent=22222222-2222-2222-2222-222222222222&preview=11111111-1111-1111-1111-111111111111");
  });

  it("passes on Drive's reason when it refuses", async () => {
    const f = (async () => new Response(JSON.stringify({ error: "This file is bigger than your remaining storage" }), { status: 413 })) as unknown as typeof fetch;
    await expect(saveToDrive(me, "x.png", new Uint8Array([1]), "image/png", f)).rejects.toThrow(/remaining storage/);
    const g = (async () => new Response("{}", { status: 404 })) as unknown as typeof fetch;
    await expect(readFromDrive(me, "11111111-1111-1111-1111-111111111111", g)).rejects.toThrow(/isn't in your Drive/);
    await expect(readFromDrive(me, "../../etc", g)).rejects.toThrow(/Not found/);
  });

  it("reads .excalidraw files and writes them back", () => {
    expect(() => parseExcalidraw("{}")).toThrow(/isn't a whiteboard/);
    expect(() => parseExcalidraw("nope")).toThrow(/isn't a whiteboard/);
    const s = parseExcalidraw(JSON.stringify({
      type: "excalidraw",
      elements: [{ id: "a", type: "image", fileId: "f1" }, { bad: true }],
      files: { f1: { id: "f1", mimeType: "image/png", dataURL: "data:image/png;base64,AA" }, f2: { id: "f2", dataURL: "data:x" } },
    }));
    expect(s.elements.map((e) => e.id)).toEqual(["a"]);
    const back = JSON.parse(toExcalidrawFile(s));
    expect(Object.keys(back.files)).toEqual(["f1"]);
    expect(back.type).toBe("excalidraw");
  });
});
