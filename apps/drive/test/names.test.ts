import { describe, expect, it } from "vitest";
import { cleanName, disposition, mimeFor, parseRange, previewKind, servedType, splitPath, uniqueName } from "../lib/names";

describe("file names", () => {
  it("cleans names so they work on every OS", () => {
    expect(cleanName("  report: final?.pdf ")).toBe("report- final-.pdf");
    expect(cleanName("notes...")).toBe("notes");
    expect(cleanName("CON")).toBe("CON_");
    expect(() => cleanName("..")).toThrow();
    expect(() => cleanName("   ")).toThrow();
  });

  it("numbers duplicates before the extension", () => {
    expect(uniqueName("a.txt", [])).toBe("a.txt");
    expect(uniqueName("a.txt", ["A.TXT"])).toBe("a (1).txt");
    expect(uniqueName("a.txt", ["a.txt", "a (1).txt"])).toBe("a (2).txt");
    expect(uniqueName("v1.2", ["v1.2"], true)).toBe("v1.2 (1)");
  });

  it("splits folder-upload paths and refuses to climb out", () => {
    expect(splitPath("Photos/2026/beach.jpg")).toEqual(["Photos", "2026", "beach.jpg"]);
    expect(splitPath("a\\b.txt")).toEqual(["a", "b.txt"]);
    expect(() => splitPath("a/../../etc/passwd")).toThrow();
    expect(() => splitPath("")).toThrow();
  });
});

describe("serving files", () => {
  it("never serves uploaded pages or scripts as runnable content", () => {
    expect(servedType(mimeFor("page.html"))).toBe("text/plain; charset=utf-8");
    expect(servedType(mimeFor("app.js"))).toBe("text/plain; charset=utf-8");
    expect(servedType(mimeFor("feed.xml"))).toBe("text/plain; charset=utf-8");
    expect(previewKind(mimeFor("logo.svg"))).toBe("image");
    expect(previewKind(mimeFor("deck.pptx"))).toBe("none");
    expect(mimeFor("README")).toBe("application/octet-stream");
  });

  it("names downloads safely, keeping the real name for browsers that read it", () => {
    expect(disposition("attachment", 'Résumé "v2".pdf')).toBe(
      `attachment; filename="R_sum_ _v2_.pdf"; filename*=UTF-8''R%C3%A9sum%C3%A9%20%22v2%22.pdf`,
    );
  });

  it("parses byte ranges for video seeking", () => {
    expect(parseRange("bytes=0-99", 1000)).toEqual({ start: 0, end: 99 });
    expect(parseRange("bytes=900-", 1000)).toEqual({ start: 900, end: 999 });
    expect(parseRange("bytes=-100", 1000)).toEqual({ start: 900, end: 999 });
    expect(parseRange("bytes=0-5000", 1000)).toEqual({ start: 0, end: 999 });
    expect(parseRange("bytes=2000-", 1000)).toBeNull();
    expect(parseRange(null, 1000)).toBeNull();
  });
});
