import { describe, expect, it } from "vitest";
import { livekitApiUrl, livekitWsUrl } from "../lib/livekit";

describe("media server addresses", () => {
  it("calls the server API on the internal network when compose sets it", () => {
    expect(livekitApiUrl({ LIVEKIT_API_URL: "http://livekit:7880", SUITE_DOMAIN: "example.com" })).toBe("http://livekit:7880");
    expect(livekitApiUrl({ SUITE_DOMAIN: "example.com" })).toBe("https://meet.example.com");
  });

  it("sends the browser to the gateway under the suite domain, read at run time", () => {
    expect(livekitWsUrl({ SUITE_DOMAIN: "example.com" })).toBe("wss://meet.example.com");
    expect(livekitWsUrl({ SUITE_DOMAIN: "example.com", NEXT_PUBLIC_LIVEKIT_URL: "wss://media.example.com" })).toBe("wss://media.example.com");
    expect(livekitWsUrl({ SUITE_DOMAIN: "example.com", LIVEKIT_WS_URL: "wss://other.example.com", NEXT_PUBLIC_LIVEKIT_URL: "wss://media.example.com" })).toBe("wss://other.example.com");
    expect(livekitWsUrl({})).toBeUndefined();
  });
});
