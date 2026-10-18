import { describe, expect, it } from "vitest";
import { blocks } from "../components/Prose";
import { limit } from "../lib/ratelimit";
import { link, slugify } from "../lib/util";

describe("helpers", () => {
  it("makes public links from titles", () => {
    expect(slugify("Senior Engineer (Remote)")).toBe("senior-engineer-remote");
    expect(slugify("Café Manager")).toBe("cafe-manager");
    expect(slugify("!!!")).toBe("job");
  });

  it("accepts only web links", () => {
    expect(link("")).toBe("");
    expect(link("https://example.org/cv.pdf")).toBe("https://example.org/cv.pdf");
    expect(() => link("javascript:alert(1)")).toThrow();
    expect(() => link("data:text/html,hi")).toThrow();
  });

  it("splits a description into paragraphs, lists and headings", () => {
    const b = blocks("About the role\nWe make things.\n\nWhat you'll do:\n- Design\n- Ship\n\n## Perks\nLunch");
    expect(b.map((x) => x.kind)).toEqual(["p", "h", "ul", "h", "p"]);
    expect(b[2].lines).toEqual(["Design", "Ship"]);
  });

  it("limits how often one address can apply", () => {
    for (let i = 0; i < 3; i++) limit("t", 3, 1000, 0);
    expect(() => limit("t", 3, 1000, 10)).toThrow(/Too many/);
    expect(() => limit("t", 3, 1000, 2000)).not.toThrow();
  });
});
