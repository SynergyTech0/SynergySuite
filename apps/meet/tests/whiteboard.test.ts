import { describe, expect, it } from "vitest";
import { meetingBoard, staffIn, whiteboardUrl } from "../lib/whiteboard";

describe("meeting whiteboard", () => {
  it("counts only signed-in people, once each", () => {
    expect(staffIn([{ identity: "a@x.com" }, { identity: "guest:Sam#ab12" }, { identity: "a@x.com" }, { identity: "egress-bot" }, { identity: "b@x.com" }])).toEqual(["a@x.com", "b@x.com"]);
  });

  it("asks Whiteboard for the room's board with the gateway secret", async () => {
    let call: { url: string; init: RequestInit } | null = null;
    const f = (async (url: string, init: RequestInit) => {
      call = { url, init };
      return new Response(JSON.stringify({ id: "b1", url: "https://whiteboard.example.com/b/b1", created: true }));
    }) as unknown as typeof fetch;
    const out = await meetingBoard("standup", "a@x.com", ["a@x.com", "b@x.com"], { env: { NODE_ENV: "production", PROXY_SHARED_SECRET: "s" }, fetch: f });
    expect(out).toEqual({ id: "b1", url: "https://whiteboard.example.com/b/b1", created: true });
    expect(call!.url).toBe("http://whiteboard:3750/api/svc/boards");
    expect((call!.init.headers as Record<string, string>)["x-proxy-auth-secret"]).toBe("s");
    expect(JSON.parse(String(call!.init.body))).toMatchObject({ source: "meet:standup", owner: "a@x.com", people: ["a@x.com", "b@x.com"] });
  });

  it("says why when Whiteboard refuses or isn't there", async () => {
    const no = (async () => new Response(JSON.stringify({ error: "Not found" }), { status: 404 })) as unknown as typeof fetch;
    await expect(meetingBoard("r", "a@x.com", [], { env: {}, fetch: no })).rejects.toThrow(/Not found/);
    const down = (async () => { throw new TypeError("fetch failed"); }) as unknown as typeof fetch;
    await expect(meetingBoard("r", "a@x.com", [], { env: {}, fetch: down })).rejects.toThrow(/Couldn't reach/);
    expect(whiteboardUrl({ WHITEBOARD_INTERNAL_URL: "http://wb:1/" })).toBe("http://wb:1");
  });
});
