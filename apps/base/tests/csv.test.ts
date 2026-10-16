import { describe, expect, it } from "vitest";
import { csvCell, csvLine, headerNames, inferType, parseCsv } from "@/lib/csv";

describe("parseCsv", () => {
  it("handles quotes, doubled quotes, newlines in cells and CRLF", () => {
    expect(parseCsv('a,b\r\n"x, y","he said ""hi"""\n"multi\nline",2\n')).toEqual([
      ["a", "b"],
      ["x, y", 'he said "hi"'],
      ["multi\nline", "2"],
    ]);
  });
  it("detects semicolons and tabs, drops a BOM and blank lines", () => {
    expect(parseCsv("﻿a;b\n1;2\n\n")).toEqual([["a", "b"], ["1", "2"]]);
    expect(parseCsv("a\tb\n1\t2")).toEqual([["a", "b"], ["1", "2"]]);
  });
});

describe("export", () => {
  it("quotes when needed and defuses formulas", () => {
    expect(csvCell('a "b"')).toBe('"a ""b"""');
    expect(csvCell("=SUM(A1)")).toBe("'=SUM(A1)");
    expect(csvCell("-5")).toBe("-5");
    expect(csvCell(["a", "b"])).toBe("a; b");
    expect(csvLine([true, null, 3])).toBe("Yes,,3\r\n");
  });
});

describe("inferType", () => {
  it("picks the narrowest type every value fits", () => {
    expect(inferType(["1", "2.5", ""])).toBe("number");
    expect(inferType(["$1.00", "$2,000.50"])).toBe("currency");
    expect(inferType(["2026-01-01", "1/2/2026"])).toBe("date");
    expect(inferType(["2026-01-01T10:00:00Z"])).toBe("datetime");
    expect(inferType(["yes", "No"])).toBe("yesno");
    expect(inferType(["a@b.co"])).toBe("email");
    expect(inferType(["https://x.y"])).toBe("hyperlink");
    expect(inferType(["one", "2"])).toBe("text");
    expect(inferType(["02134", "10001"])).toBe("text");
    expect(inferType(["x".repeat(300)])).toBe("longtext");
    expect(inferType(["", ""])).toBe("text");
  });
  it("makes unique field names and never a second ID", () => {
    expect(headerNames(["Name", "name", "", "ID"])).toEqual(["Name", "name 2", "Field3", "ID (imported)"]);
  });
});
