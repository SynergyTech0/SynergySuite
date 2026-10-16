import { describe, expect, it } from "vitest";
import { safeNext, studioLink } from "../lib/api";

describe("designer sign-in", () => {
  it("only opens paths inside the designer", () => {
    expect(safeNext("/projects/p1/flows/f1")).toBe("/projects/p1/flows/f1");
    for (const bad of [null, "", "https://evil.test/", "//evil.test", "/\\evil.test", "javascript:alert(1)", "/a b"]) expect(safeNext(bad)).toBe("/");
  });

  it("links to the designer's sign-in on its own host", () => {
    expect(studioLink("/x", { SUITE_DOMAIN: "suite.test" } as unknown as NodeJS.ProcessEnv)).toBe("https://flow-studio.suite.test/synergy/sso?next=%2Fx");
  });
});
