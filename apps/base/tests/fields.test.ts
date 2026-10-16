import { describe, expect, it } from "vitest";
import { cleanName, cleanOptions, coerce, conversionSql, parseDate, parseDateTime, parseNumber, pgType, type Field } from "@/lib/fields";

const f = (type: Field["type"], options: Field["options"] = {}) => ({ name: "F", type, options });

describe("coerce", () => {
  it("treats blanks as empty", () => {
    expect(coerce(f("text"), "  ")).toBeNull();
    expect(coerce(f("number"), null)).toBeNull();
    expect(coerce(f("multichoice", { choices: ["a"] }), [])).toBeNull();
  });

  it("checks text length and kinds", () => {
    expect(coerce(f("text"), " hi ")).toBe("hi");
    expect(() => coerce(f("text", { maxLength: 3 }), "abcd")).toThrow(/at most 3/);
    expect(coerce(f("email"), "a@b.co")).toBe("a@b.co");
    expect(() => coerce(f("email"), "nope")).toThrow(/email/);
    expect(() => coerce(f("hyperlink"), "javascript:alert(1)")).toThrow(/http/);
    expect(coerce(f("longtext"), "line 1\nline 2 ")).toBe("line 1\nline 2 ");
  });

  it("reads numbers exactly, with or without separators", () => {
    expect(coerce(f("number"), "1,234.50")).toBe("1234.50");
    expect(coerce(f("currency"), "$19.99")).toBe("19.99");
    expect(coerce(f("number"), 7)).toBe("7");
    expect(coerce(f("currency"), "-$5.25")).toBe("-5.25");
    expect(() => coerce(f("number"), "12abc")).toThrow(/number/);
    expect(() => coerce(f("number"), "1e9")).toThrow(/number/);
    expect(() => coerce(f("number"), Infinity)).toThrow(/number/);
  });

  it("reads dates in ISO and US order and refuses impossible ones", () => {
    expect(coerce(f("date"), "2026-10-16")).toBe("2026-10-16");
    expect(coerce(f("date"), "10/16/2026")).toBe("2026-10-16");
    expect(coerce(f("date"), "2026-10-16T09:00:00Z")).toBe("2026-10-16");
    expect(() => coerce(f("date"), "2026-02-30")).toThrow(/date/);
    expect(coerce(f("datetime"), "2026-10-16T09:30:00Z")).toBe("2026-10-16T09:30:00.000Z");
    expect(() => coerce(f("datetime"), "soon")).toThrow(/date and time/);
  });

  it("reads yes/no the ways Access and spreadsheets write it", () => {
    expect(coerce(f("yesno"), "Yes")).toBe(true);
    expect(coerce(f("yesno"), "-1")).toBe(true);
    expect(coerce(f("yesno"), false)).toBe(false);
    expect(() => coerce(f("yesno"), "maybe")).toThrow();
  });

  it("only accepts listed choices", () => {
    const opts = { choices: ["Red", "Blue"] };
    expect(coerce(f("choice", opts), "Red")).toBe("Red");
    expect(() => coerce(f("choice", opts), "Green")).toThrow(/Green/);
    expect(coerce(f("multichoice", opts), "Red; Blue; Red")).toEqual(["Red", "Blue"]);
    expect(() => coerce(f("multichoice", opts), ["Red", "Pink"])).toThrow(/Pink/);
  });

  it("never lets anyone set the AutoNumber", () => {
    expect(() => coerce(f("autonumber"), 5)).toThrow(/AutoNumber/);
  });
});

describe("options and names", () => {
  it("keeps only options that fit the type", () => {
    expect(cleanOptions("text", { maxLength: 50, decimals: 2, unique: true })).toEqual({ maxLength: 50, unique: true });
    expect(cleanOptions("longtext", { unique: true })).toEqual({});
    expect(cleanOptions("choice", { choices: [" a", "b", "a", ""] })).toEqual({ choices: ["a", "b"] });
    expect(() => cleanOptions("text", { maxLength: 999 })).toThrow();
    expect(cleanOptions("yesno", { defaultValue: "yes" })).toEqual({ defaultValue: true });
    expect(() => cleanOptions("number", { defaultValue: "abc" })).toThrow(/number/);
  });

  it("tidies names", () => {
    expect(cleanName("  Order   Date ")).toBe("Order Date");
    expect(() => cleanName("")).toThrow();
    expect(() => cleanName("x".repeat(65))).toThrow();
    expect(() => cleanName("a\u0000b")).toThrow();
  });
});

describe("parsers", () => {
  it("parse as documented", () => {
    expect(parseNumber("+.5")).toBe(".5");
    expect(parseNumber("1,23")).toBeNull();
    expect(parseDate("2/29/2024")).toBe("2024-02-29");
    expect(parseDate("2/29/2023")).toBeNull();
    expect(parseDateTime("2026-01-01")).toBe("2026-01-01T00:00:00.000Z");
  });
});

describe("type changes", () => {
  it("uses a plain cast when the column type stays", () => {
    expect(conversionSql('"c"', "text", "email")).toBe('"c"');
    expect(pgType("email")).toBe("text");
  });
  it("converts lists and booleans", () => {
    expect(conversionSql('"c"', "multichoice", "text")).toBe(`array_to_string("c", '; ')`);
    expect(conversionSql('"c"', "text", "multichoice")).toContain("regexp_split_to_array");
    expect(conversionSql('"c"', "number", "yesno")).toBe('("c" <> 0)');
    expect(conversionSql('"c"', "text", "number")).toBe(`NULLIF(btrim("c"::text), '')::numeric`);
  });
});
