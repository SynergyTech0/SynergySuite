import { describe, expect, it } from "vitest";
import type { ListResponse } from "imapflow";
import { parseCsv } from "../lib/migrate/discover";
import { Graph, GraphError } from "../lib/migrate/graph";
import { placeFolders } from "../lib/migrate/imap";
import { htmlToText, repeatOf, toContact, toEvent, utc } from "../lib/migrate/pim";
import { open, seal } from "../lib/migrate/secret";
import { gatewayHeaders } from "../lib/migrate/suite";

const creds = { tenantId: "contoso.onmicrosoft.com", clientId: "c", clientSecret: "s" };

function scripted(answers: (() => Response)[]) {
  const calls: string[] = [];
  const f = (async (url: RequestInfo | URL, init?: RequestInit) => {
    calls.push(`${init?.method ?? "GET"} ${String(url)} ${(init?.headers as Record<string, string>)?.Authorization ?? ""}`);
    if (String(url).includes("/oauth2/v2.0/token")) return Response.json({ access_token: `t${calls.length}`, expires_in: 3600 });
    const next = answers.shift();
    if (!next) throw new Error("no more answers");
    return next();
  }) as typeof fetch;
  return { f, calls };
}

describe("Graph client", () => {
  it("waits as long as Retry-After says, in seconds or as a date, and counts it", async () => {
    const waits: number[] = [];
    const later = new Date(Date.now() + 5000).toUTCString();
    const { f } = scripted([
      () => new Response("{}", { status: 429, headers: { "Retry-After": "2" } }),
      () => new Response("{}", { status: 503, headers: { "Retry-After": later } }),
      () => Response.json({ value: [{ id: "1" }] }),
    ]);
    const g = new Graph(creds, { fetch: f, sleep: async (ms) => void waits.push(ms), graphUrl: "https://graph.example/v1.0" });
    expect((await g.page("/users")).value).toEqual([{ id: "1" }]);
    expect(waits[0]).toBe(2000);
    expect(waits[1]).toBeGreaterThan(3000);
    expect(waits[1]).toBeLessThanOrEqual(5000);
    expect(g.throttled).toBe(2);
  });

  it("gives up after its retries, renews an expired token once, and explains errors", async () => {
    const { f, calls } = scripted([
      () => new Response("{}", { status: 401 }),
      () => Response.json({ ok: 1 }),
      ...Array.from({ length: 3 }, () => () => new Response("{}", { status: 429, headers: { "Retry-After": "1" } })),
      () => Response.json({ error: { code: "Authorization_RequestDenied", message: "Insufficient privileges" } }, { status: 403 }),
    ]);
    const g = new Graph(creds, { fetch: f, sleep: async () => {}, maxRetries: 2, graphUrl: "https://graph.example/v1.0" });
    expect(await g.json("/me")).toEqual({ ok: 1 });
    expect(calls.filter((c) => c.includes("/token")).length).toBe(2);
    await expect(g.json("/x")).rejects.toMatchObject({ status: 429 });
    const err = await g.json("/y").catch((e) => e);
    expect(err).toBeInstanceOf(GraphError);
    expect(err).toMatchObject({ status: 403, code: "Authorization_RequestDenied", message: "Microsoft Graph: Insufficient privileges" });
  });

  it("never sends its token to another host", async () => {
    const { f } = scripted([]);
    const g = new Graph(creds, { fetch: f, graphUrl: "https://graph.example/v1.0" });
    await expect(g.page("https://evil.example/v1.0/users?$skiptoken=1")).rejects.toThrow(/another host/);
    expect(() => new Graph({ ...creds, tenantId: "bad/../tenant" })).toThrow(/tenant/);
  });

  it("refuses downloads over the limit without reading them", async () => {
    const { f } = scripted([() => new Response("x".repeat(100), { headers: { "Content-Length": "100" } })]);
    const g = new Graph(creds, { fetch: f, graphUrl: "https://graph.example/v1.0" });
    await expect(g.bytes("/m/$value", 10)).rejects.toThrow(/Too large/);
  });
});

describe("conversions", () => {
  it("reads Microsoft's usage report CSV", () => {
    expect(parseCsv('﻿A,B\r\n1,"x, ""y"""\r\n\r\n2,z')).toEqual([{ A: "1", B: 'x, "y"' }, { A: "2", B: "z" }]);
  });

  it("turns Outlook bodies, times, recurrences and contacts into the suite's shapes", () => {
    expect(htmlToText("<html><head><style>p{}</style></head><body><p>Hi&nbsp;<b>there</b></p><p>a &amp; b</p></body></html>")).toBe("Hi there\na & b");
    expect(utc({ dateTime: "2026-01-02T03:04:05.0000000", timeZone: "UTC" })).toBe("2026-01-02T03:04:05.000Z");
    expect(utc({ dateTime: "nope" })).toBe(null);
    expect(repeatOf({ pattern: { type: "absoluteMonthly", interval: 1 } })).toBe("monthly");
    expect(repeatOf({ pattern: { type: "daily", interval: 2 } })).toBe(null);
    expect(repeatOf({ pattern: { type: "weekly", interval: 1, daysOfWeek: ["monday"] } })).toBe("weekly");
    const c = toContact({ id: "1", givenName: "Ann", homeAddress: { street: "1 Main", city: "Oslo", countryOrRegion: "Norway" }, homePhones: ["123"], emailAddresses: [{ address: "a@x.test" }, { address: "b@x.test" }] });
    expect(c).toMatchObject({ firstName: "Ann", phones: [{ label: "home", value: "123" }], emails: [{ label: "work", value: "a@x.test" }, { label: "other", value: "b@x.test" }] });
    expect(c.addresses).toEqual([{ label: "home", street: "1 Main", city: "Oslo", region: "", postcode: "", country: "Norway" }]);
    const e = toEvent({ id: "e", subject: "Lunch", isOrganizer: false, organizer: { emailAddress: { address: "x@y.test", name: "X" } }, start: { dateTime: "2026-01-01T12:00:00" }, end: { dateTime: "2026-01-01T12:00:00" }, attendees: [{ emailAddress: { address: "z@y.test" } }] }, (a) => a);
    expect(e).toMatchObject({ title: "Lunch", attendees: [], description: "Organizer: X <x@y.test>", endAt: "2026-01-01T12:01:00.000Z" });
  });

  it("places IMAP folders under the suite's well-known folders", () => {
    const box = (path: string, specialUse?: string, flags: string[] = []) => ({ path, delimiter: "/", specialUse, flags: new Set(flags) }) as unknown as ListResponse;
    const out = placeFolders([box("INBOX"), box("INBOX/Clients"), box("[Gmail]", undefined, ["\\Noselect"]), box("[Gmail]/Sent Mail", "\\Sent"), box("[Gmail]/All Mail", "\\All"), box("[Gmail]/Starred"), box("Old/2019")]);
    expect(out.map((f) => [f.path, f.place])).toEqual([
      ["INBOX", { role: "inbox", path: [] }],
      ["INBOX/Clients", { role: "inbox", path: ["Clients"] }],
      ["[Gmail]/Sent Mail", { role: "sent", path: [] }],
      ["[Gmail]/Starred", { role: null, path: ["Starred"] }],
      ["Old/2019", { role: null, path: ["Old", "2019"] }],
    ]);
  });

  it("seals secrets and sends the gateway headers", () => {
    const s = seal("hunter2");
    expect(s).not.toContain("hunter2");
    expect(open(s)).toBe("hunter2");
    expect(gatewayHeaders({ email: "a@x.test", name: "A" }, { PROXY_SHARED_SECRET: "gw" } as unknown as NodeJS.ProcessEnv)).toEqual({
      "x-auth-request-email": "a@x.test", "x-auth-request-user": "a@x.test", "x-auth-request-preferred-username": "A", "x-proxy-auth-secret": "gw",
    });
  });
});
