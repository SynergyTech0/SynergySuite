import { describe, expect, it } from "vitest";
import { matchesQuery, parseQuery } from "@synergy/compliance";
import type { ImapFlow } from "imapflow";
import { searchCompiler } from "imapflow/lib/search-compiler.js";
import {
  dateBounds, decodeCursor, decodeId, encodeCursor, encodeId, imapSearch, inRange, parseSearchRequest,
} from "../lib/compliance";
import { evaluate, message } from "./fake-imap";

const none: { from: Date | null; to: Date | null } = { from: null, to: null };
const conn = { enabled: new Set(), capabilities: new Set() } as unknown as ImapFlow;
type Attr = { type: string; value: unknown } | Attr[];
const flat = (a: Attr[]): string => a.map((x) => (Array.isArray(x) ? `(${flat(x)})` : String(x.value))).join(" ");
const imap = (q: string, b = none) => flat(searchCompiler(conn, imapSearch(parseQuery(q), b)) as Attr[]);

describe("query translation", () => {
  it("turns words, phrases and OR into IMAP TEXT, leaving exclusions to the post-filter", () => {
    expect(imap("")).toBe("ALL");
    expect(imap("invoice")).toBe("TEXT invoice");
    expect(imap('invoice "big deal" OR contract -draft')).toBe("TEXT invoice NOT NOT OR TEXT big deal TEXT contract");
    expect(imap("a b c")).toBe("TEXT a NOT NOT (TEXT b NOT NOT TEXT c)");
  });

  it("widens dates by a day, since IMAP compares days without time zones", () => {
    const b = dateBounds("2026-03-02", "2026-03-04");
    expect(imap("", b)).toBe("SENTSINCE 01-Mar-2026 NOT NOT SENTBEFORE 06-Mar-2026");
    expect(imap("x", b)).toBe("SENTSINCE 01-Mar-2026 NOT NOT (SENTBEFORE 06-Mar-2026 NOT NOT TEXT x)");
    expect(flat(searchCompiler(conn, imapSearch(parseQuery("x"), b, false)) as Attr[])).toBe("SENTSINCE 01-Mar-2026 NOT NOT SENTBEFORE 06-Mar-2026");
  });

  it("never drops a message the query matches", () => {
    const raw = Buffer.from(message({ subject: "Quarterly Invoice", from: "Ann <ann@example.com>", to: "bob@example.com", body: "The big deal closed. Draft attached." }));
    for (const q of ["invoice", "INVOICE deal", '"big deal" OR nothing', "nothing OR ann@example", "invoice -draft", "missing", "-draft"]) {
      const p = parseQuery(q);
      const pre = evaluate({ uid: 1, raw }, imapSearch(p, none));
      const exact = matchesQuery(raw.toString(), p);
      if (exact) expect(pre, q).toBe(true);
    }
  });

  it("treats a bare to date as the whole day", () => {
    const b = dateBounds("2026-03-02", "2026-03-04");
    expect(inRange(new Date("2026-03-04T23:30:00Z"), b)).toBe(true);
    expect(inRange(new Date("2026-03-05T00:00:01Z"), b)).toBe(false);
    expect(inRange(new Date("2026-03-01T23:59:59Z"), b)).toBe(false);
  });
});

describe("ids and cursors", () => {
  const hash = "a".repeat(64);

  it("round-trips live and preserved ids", () => {
    const live = { kind: "live" as const, mailbox: "ann@example.com", folder: "Archive/2026 é", uidValidity: "1712345678", uid: 42, hash };
    const kept = { kind: "kept" as const, mailbox: "ann@example.com", hash };
    expect(decodeId(encodeId(live))).toEqual(live);
    expect(decodeId(encodeId(kept))).toEqual(kept);
    expect(encodeId(live)).toMatch(/^l\.[\w-]+$/);
  });

  it("rejects ids that aren't ours", () => {
    for (const bad of ["", "x.abc", "l.!!!", `p.${Buffer.from('["a","short"]').toString("base64url")}`,
      `l.${Buffer.from(JSON.stringify(["a", "INBOX", "1", 0, hash])).toString("base64url")}`, 7, null]) {
      expect(decodeId(bad), String(bad)).toBeNull();
    }
  });

  it("round-trips cursors", () => {
    for (const c of [{ m: "a@example.com", phase: "live" as const, f: "INBOX", u: 0 }, { m: "b@example.com", phase: "kept" as const, k: 17 }]) {
      expect(decodeCursor(encodeCursor(c))).toEqual(c);
    }
    expect(decodeCursor("nonsense")).toBeNull();
  });
});

describe("search requests", () => {
  it("normalises and caps", () => {
    expect(parseSearchRequest({ custodians: [" Ann@Example.com ", "ann@example.com"], limit: 5000 })).toMatchObject({ custodians: ["ann@example.com"], limit: 200, query: "" });
  });

  it("refuses bad input", () => {
    for (const bad of [null, [], { query: 3 }, { custodians: "a" }, { from: "yesterday" }, { limit: 0 }, { limit: 1.5 }, { cursor: "zzz" }, { kinds: [1] }]) {
      expect(() => parseSearchRequest(bad), JSON.stringify(bad)).toThrow();
    }
  });
});
