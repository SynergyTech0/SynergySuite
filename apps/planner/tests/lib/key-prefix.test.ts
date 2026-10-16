import { describe, expect, it } from "vitest";
import { normalisePrefix, PREFIX, prefixFromTitle } from "@/lib/key-prefix";

describe("normalisePrefix", () => {
  it("upper-cases and trims valid input", () => {
    expect(normalisePrefix(" pl ")).toBe("PL");
    expect(normalisePrefix("shop2")).toBe("SHOP2");
    expect(normalisePrefix("ABCDEFGHIJ")).toBe("ABCDEFGHIJ");
  });

  it("rejects input that can't be a prefix", () => {
    expect(normalisePrefix("P")).toBeNull();
    expect(normalisePrefix("")).toBeNull();
    expect(normalisePrefix("2PL")).toBeNull();
    expect(normalisePrefix("ABCDEFGHIJK")).toBeNull();
    expect(normalisePrefix("P-L")).toBeNull();
  });

  it("rejects non-strings", () => {
    for (const v of [undefined, null, 42, ["PL"], { p: "PL" }]) expect(normalisePrefix(v)).toBeNull();
  });
});

describe("prefixFromTitle", () => {
  it.each([
    ["Product Launch", "PL"],
    ["marketing", "MAR"],
    ["Q", "QBR"],
    ["", "BRD"],
    ["Customer Success Ops Team Extra", "CSOT"],
    ["2026 roadmap", "ROA"],
  ])("%j → %j", (title, prefix) => {
    expect(prefixFromTitle(title)).toBe(prefix);
    expect(prefixFromTitle(title)).toMatch(PREFIX);
  });
});
