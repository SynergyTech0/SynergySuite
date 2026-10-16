import { describe, expect, it } from "vitest";
import { buildAchFile, validRouting } from "../lib/payroll/nacha";
import { canEncrypt, open, seal } from "../lib/secret";

const company = {
  odfiRouting: "021000021", odfiName: "Example Bank", originId: "1123456789", originName: "Example Co",
  companyName: "Example Co", companyId: "1123456789",
};
const entries = [
  { name: "Eve Lead", id: "7", routing: "011000015", account: "123456789", type: "checking" as const, amountCents: 152_250 },
  { name: "Zed New", id: "9", routing: "121000358", account: "98765", type: "savings" as const, amountCents: 80_000 },
];
const at = new Date("2026-11-04T15:30:00Z");

describe("ACH direct deposit file", () => {
  it("checks routing numbers", () => {
    expect(validRouting("021000021")).toBe(true);
    expect(validRouting("011000015")).toBe(true);
    expect(validRouting("021000022")).toBe(false);
    expect(validRouting("12345678")).toBe(false);
  });

  it("writes 94-character records in blocks of ten", () => {
    const f = buildAchFile({ company, entries, effectiveDate: "2026-11-06", createdAt: at });
    const lines = f.text.trimEnd().split("\r\n");
    expect(lines.every((l) => l.length === 94)).toBe(true);
    expect(lines.length).toBe(10);
    expect(lines.map((l) => l[0]).join("")).toBe("1566899999");
    expect(lines[0]).toBe("101 0210000211123456789261104153" + "0A094101EXAMPLE BANK           EXAMPLE CO                     ");
    expect(lines[1].slice(0, 4)).toBe("5220");
    expect(lines[1].slice(50, 63)).toBe("PPDPAYROLL   ");
    expect(lines[1].slice(69, 75)).toBe("261106");
    // Checking credit: code 22, RDFI 01100001, check digit 5, account, $1,522.50, trace = ODFI + 1.
    expect(lines[2]).toBe("622011000015123456789        0000152250" + "7              EVE LEAD              " + "  0" + "021000020000001");
    expect(lines[3].slice(1, 3)).toBe("32");
    // Entry hash is the sum of the 8-digit RDFI numbers: 01100001 + 12100035.
    expect(lines[4].slice(10, 20)).toBe("0013200036");
    expect(lines[4].slice(32, 44)).toBe("000000232250");
    expect(lines[5]).toMatch(/^9000001000001000000020013200036000000000000000000232250 +$/);
    expect(f).toMatchObject({ entryCount: 2, totalCreditCents: 232_250, totalDebitCents: 0 });
  });

  it("balances with a debit from the company account when asked", () => {
    const f = buildAchFile({ company: { ...company, offset: { routing: "021000021", account: "555", type: "checking" } }, entries, effectiveDate: "2026-11-06", createdAt: at });
    const lines = f.text.trimEnd().split("\r\n");
    expect(lines[1].slice(1, 4)).toBe("200");
    expect(lines[4].slice(1, 3)).toBe("27");
    expect(lines[5].slice(20, 44)).toBe("000000232250000000232250");
  });

  it("refuses bad bank details", () => {
    expect(() => buildAchFile({ company, entries: [{ ...entries[0], routing: "011000016" }], effectiveDate: "2026-11-06" })).toThrow(/routing/);
    expect(() => buildAchFile({ company: { ...company, odfiRouting: "1" }, entries, effectiveDate: "2026-11-06" })).toThrow(/routing/);
    expect(() => buildAchFile({ company, entries: [], effectiveDate: "2026-11-06" })).toThrow(/No direct deposits/);
  });
});

describe("sealed fields", () => {
  const env = { HR_DATA_KEY: "11".repeat(32) } as unknown as NodeJS.ProcessEnv;
  it("round-trips and never stores the plain text", () => {
    const s = seal("123-45-6789", env);
    expect(s).not.toContain("6789");
    expect(seal("123-45-6789", env)).not.toBe(s);
    expect(open(s, env)).toBe("123-45-6789");
    expect(() => open(s, { HR_DATA_KEY: "22".repeat(32) } as unknown as NodeJS.ProcessEnv)).toThrow();
  });
  it("needs a key", () => {
    expect(canEncrypt({} as unknown as NodeJS.ProcessEnv)).toBe(false);
    expect(() => seal("x", {} as unknown as NodeJS.ProcessEnv)).toThrow(/HR_DATA_KEY/);
  });
});
