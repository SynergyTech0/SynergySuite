import { describe, expect, it } from "vitest";
import { diffLines } from "../lib/diff";
import { fillTemplate, templateClauses, templateFields } from "../lib/template";

describe("templates", () => {
  const body = "# {{Title}}\nBetween us and {{Counterparty}} for {{Service}}.\nFee: {{ fee }} per {{Service}}.\n\n{{clause: Confidentiality}}\n{{clause:Governing law}}";

  it("lists the fields to ask for, without built-ins or clauses", () => {
    expect(templateFields(body)).toEqual(["Service", "fee"]);
    expect(templateClauses(body)).toEqual(["Confidentiality", "Governing law"]);
  });

  it("fills fields and clauses ignoring case, and marks what's missing", () => {
    const out = fillTemplate(body, { title: "Support agreement", counterparty: "Acme", service: "month", Fee: "" }, { confidentiality: "Keep it secret." });
    expect(out).toBe(
      "# Support agreement\nBetween us and Acme for month.\nFee: [fee] per month.\n\nKeep it secret.\n[Clause \"Governing law\" is not in the library]",
    );
  });
});

describe("redline", () => {
  it("shows added and removed lines between versions", () => {
    const d = diffLines("a\nb\nc\nd", "a\nB\nc\nd\ne");
    expect(d).toEqual([
      { op: "same", text: "a" },
      { op: "del", text: "b" },
      { op: "add", text: "B" },
      { op: "same", text: "c" },
      { op: "same", text: "d" },
      { op: "add", text: "e" },
    ]);
  });

  it("copes with very long texts", () => {
    const a = Array.from({ length: 5000 }, (_, i) => `line ${i}`).join("\n");
    const b = Array.from({ length: 5000 }, (_, i) => `row ${i}`).join("\n");
    const d = diffLines(a, b);
    expect(d.filter((l) => l.op === "del")).toHaveLength(5000);
    expect(d.filter((l) => l.op === "add")).toHaveLength(5000);
  });
});
