import { describe, expect, it } from "vitest";
import { open, seal } from "../lib/secret";

describe("seal/open", () => {
  it("round-trips and never stores the plain text", () => {
    const s = seal("app-password-123");
    expect(s).not.toContain("app-password-123");
    expect(open(s)).toBe("app-password-123");
    expect(seal("same")).not.toBe(seal("same")); // fresh IV every time
  });

  it("rejects tampered values", () => {
    const [v, iv, tag, body] = seal("secret").split(".");
    const flipped = Buffer.from(body, "base64");
    flipped[0] ^= 1;
    expect(() => open([v, iv, tag, flipped.toString("base64")].join("."))).toThrow();
  });
});
