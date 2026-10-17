const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const {
  createDavHandler, parseXml, parseICalendar, serialize, fromWallTime, wallTime, formatLocal, parseDateText,
  zoneFor, parseDuration, fold, appPasswordVerifier, DavError,
} = require("../dist");

test("wall times in a zone across daylight saving changes", () => {
  const ny = "America/New_York";
  assert.equal(fromWallTime({ year: 2026, month: 3, day: 7, hour: 9, minute: 0, second: 0 }, ny).toISOString(), "2026-03-07T14:00:00.000Z");
  assert.equal(fromWallTime({ year: 2026, month: 3, day: 9, hour: 9, minute: 0, second: 0 }, ny).toISOString(), "2026-03-09T13:00:00.000Z");
  // 02:30 doesn't exist on 8 March: read with the offset from before the gap, i.e. 03:30 EDT.
  assert.equal(fromWallTime({ year: 2026, month: 3, day: 8, hour: 2, minute: 30, second: 0 }, ny).toISOString(), "2026-03-08T07:30:00.000Z");
  // 01:30 happens twice on 1 November: the first one (EDT).
  assert.equal(fromWallTime({ year: 2026, month: 11, day: 1, hour: 1, minute: 30, second: 0 }, ny).toISOString(), "2026-11-01T05:30:00.000Z");
  assert.deepEqual(wallTime(new Date("2026-07-01T12:00:00Z"), "Europe/Berlin"), { year: 2026, month: 7, day: 1, hour: 14, minute: 0, second: 0 });
  assert.equal(formatLocal(new Date("2026-01-01T12:00:00Z"), "Asia/Kolkata"), "20260101T173000");
  assert.equal(fromWallTime({ year: 2026, month: 1, day: 1, hour: 17, minute: 30, second: 0 }, "Asia/Kolkata").toISOString(), "2026-01-01T12:00:00.000Z");
});

test("date values and zone names from clients", () => {
  assert.deepEqual(parseDateText("20260310"), { date: new Date("2026-03-10T00:00:00Z"), allDay: true, tzid: "UTC" });
  assert.equal(parseDateText("20260310T090000", undefined, "Europe/London").date.toISOString(), "2026-03-10T09:00:00.000Z");
  assert.equal(parseDateText("20260710T090000", undefined, "Europe/London").date.toISOString(), "2026-07-10T08:00:00.000Z");
  assert.equal(parseDateText("20260710T090000Z").date.toISOString(), "2026-07-10T09:00:00.000Z");
  assert.equal(zoneFor("/mozilla.org/20070129_1/America/Chicago"), "America/Chicago");
  assert.equal(zoneFor("Pacific Standard Time"), "America/Los_Angeles");
  assert.equal(zoneFor("Nowhere/Special", "Europe/Paris"), "Europe/Paris");
  assert.equal(parseDuration("PT1H30M"), 5400000);
  assert.equal(parseDuration("P1D"), 86400000);
  assert.equal(parseDuration("-PT15M"), -900000);
});

test("iCalendar text round trip with folding and escapes", () => {
  const src = "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nBEGIN:VEVENT\r\nUID:a1\r\nSUMMARY:Lunch\\, with \\;friends\r\nDESCRIPTION:line one\\nline two that is long enough to need folding across more than seventy-five octets\r\nDTSTART;TZID=\"America/New_York\":20260301T120000\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n";
  const cal = parseICalendar(src);
  assert.equal(cal.name, "VCALENDAR");
  const ev = cal.components[0];
  assert.equal(ev.props.find((p) => p.name === "DTSTART").params.TZID, "America/New_York");
  const out = serialize(cal);
  assert.ok(out.split("\r\n").every((l) => Buffer.byteLength(l) <= 75));
  assert.deepEqual(parseICalendar(out), cal);
  assert.throws(() => parseICalendar("BEGIN:VCALENDAR\r\nBEGIN:VEVENT\r\nEND:VCALENDAR"));
  assert.equal(fold("é".repeat(60)).split("\r\n ").map((l) => Buffer.byteLength(l)).every((n) => n <= 75), true);
});

test("XML is read with namespaces whatever the prefixes", () => {
  const x = parseXml(`<?xml version="1.0"?><A:propfind xmlns:A="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav"><A:prop><A:getetag/><C:calendar-data/></A:prop></A:propfind>`);
  assert.equal(x.ns, "DAV:");
  assert.deepEqual(x.children[0].children.map((c) => `{${c.ns}}${c.name}`), ["{DAV:}getetag", "{urn:ietf:params:xml:ns:caldav}calendar-data"]);
  assert.equal(parseXml("<a><b></a>"), null);
});

// A backend in memory: one writable calendar and one read-only one.
function memoryBackend() {
  let seq = 1;
  const store = { work: new Map(), shared: new Map([["s.ics", { data: "BEGIN:VCALENDAR\r\nEND:VCALENDAR\r\n", seq: 1 }]]) };
  const gone = [];
  const meta = (name, o) => ({ name, etag: `"${o.seq}"` });
  return {
    store,
    backend: {
      async collections() {
        return [
          { id: "work", displayName: "Work", readOnly: false, syncToken: String(seq), color: "#0284C7" },
          { id: "shared", displayName: "Shared", readOnly: true, syncToken: String(seq) },
        ];
      },
      async list(_u, c) { return [...store[c]].map(([n, o]) => meta(n, o)); },
      async get(_u, c, names) { return names.filter((n) => store[c]?.has(n)).map((n) => ({ ...meta(n, store[c].get(n)), data: store[c].get(n).data })); },
      async put(_u, c, name, data) {
        if (!data.includes("BEGIN:VCALENDAR")) throw new DavError(415, "not iCalendar", "{urn:ietf:params:xml:ns:caldav}valid-calendar-data");
        store[c].set(name, { data, seq: ++seq });
        return meta(name, store[c].get(name));
      },
      async remove(_u, c, name) { store[c].delete(name); gone.push({ name, seq: ++seq }); },
      async changes(_u, c, since) {
        const s = Number(since);
        if (s > seq) return null;
        return {
          token: String(seq),
          changed: [...store[c]].filter(([, o]) => o.seq > s).map(([n, o]) => meta(n, o)),
          removed: gone.filter((g) => g.seq > s).map((g) => g.name),
        };
      },
    },
  };
}

test("CalDAV protocol over a backend", async () => {
  const { backend, store } = memoryBackend();
  const dav = createDavHandler({
    kind: "calendar", backend, realm: "Test",
    authenticate: async (u, p) => (u === "ada@example.com" && p === "right" ? "ada@example.com" : null),
  });
  const auth = "Basic " + Buffer.from("ada@example.com:right").toString("base64");
  const call = (method, url, body = "", headers = {}) =>
    dav.handle({ method, url, body, headers: { authorization: auth, ...headers } });

  assert.equal((await call("GET", "/.well-known/caldav")).headers.location, "/dav/");
  assert.equal((await dav.handle({ method: "PROPFIND", url: "/dav/", body: "", headers: {} })).status, 401);
  assert.equal((await dav.handle({ method: "PROPFIND", url: "/dav/", body: "", headers: { authorization: "Basic " + Buffer.from("ada@example.com:wrong").toString("base64") } })).status, 401);
  assert.ok(dav.matches("PROPFIND", "/"));
  assert.ok(!dav.matches("GET", "/"));

  let r = await call("PROPFIND", "/", `<d:propfind xmlns:d="DAV:"><d:prop><d:current-user-principal/></d:prop></d:propfind>`, { depth: "0" });
  assert.equal(r.status, 207);
  assert.match(r.body, /<d:current-user-principal><d:href>\/dav\/principals\/ada@example.com\/<\/d:href>/);

  r = await call("PROPFIND", "/dav/principals/ada@example.com/", `<d:propfind xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav"><d:prop><c:calendar-home-set/><c:calendar-user-address-set/><d:nope/></d:prop></d:propfind>`, { depth: "0" });
  assert.match(r.body, /calendar-home-set><d:href>\/dav\/calendars\/ada@example.com\/</);
  assert.match(r.body, /mailto:ada@example.com/);
  assert.match(r.body, /<d:nope\/><\/d:prop><d:status>HTTP\/1.1 404 Not Found/);
  assert.equal((await call("PROPFIND", "/dav/principals/bob@example.com/", "", { depth: "0" })).status, 403);

  r = await call("PROPFIND", "/dav/calendars/ada@example.com/", `<propfind xmlns="DAV:"><prop><resourcetype/><displayname/><sync-token/></prop></propfind>`, { depth: "1" });
  assert.match(r.body, /<d:href>\/dav\/calendars\/ada@example.com\/work\/<\/d:href>.*<cal:calendar\/>.*Work/s);
  assert.match(r.body, /urn:synergy:sync:1/);

  // Create, refuse a duplicate create, update with the right and a stale ETag.
  const ics = "BEGIN:VCALENDAR\r\nBEGIN:VEVENT\r\nUID:x\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n";
  assert.equal((await call("PUT", "/dav/calendars/ada@example.com/work/x.ics", ics, { "if-none-match": "*" })).status, 201);
  assert.equal((await call("PUT", "/dav/calendars/ada@example.com/work/x.ics", ics, { "if-none-match": "*" })).status, 412);
  const got = await call("GET", "/dav/calendars/ada@example.com/work/x.ics");
  assert.equal(got.status, 200);
  assert.equal(got.body, ics);
  assert.equal((await call("PUT", "/dav/calendars/ada@example.com/work/x.ics", ics, { "if-match": '"999"' })).status, 412);
  assert.equal((await call("PUT", "/dav/calendars/ada@example.com/work/x.ics", ics, { "if-match": got.headers.etag })).status, 204);
  assert.equal((await call("PUT", "/dav/calendars/ada@example.com/work/y.ics", "junk")).status, 415);
  assert.equal((await call("PUT", "/dav/calendars/ada@example.com/shared/z.ics", ics)).status, 403);
  assert.equal((await call("DELETE", "/dav/calendars/ada@example.com/shared/s.ics")).status, 403);

  // Multiget: one known, one missing.
  r = await call("REPORT", "/dav/calendars/ada@example.com/work/",
    `<c:calendar-multiget xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav"><d:prop><d:getetag/><c:calendar-data/></d:prop>
     <d:href>/dav/calendars/ada@example.com/work/x.ics</d:href><d:href>https://cal.example.com/dav/calendars/ada@example.com/work/none.ics</d:href></c:calendar-multiget>`);
  assert.match(r.body, /BEGIN:VCALENDAR/);
  assert.match(r.body, /none.ics<\/d:href><d:status>HTTP\/1.1 404/);

  // A query for to-dos finds nothing here.
  r = await call("REPORT", "/dav/calendars/ada@example.com/work/",
    `<c:calendar-query xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav"><d:prop><d:getetag/></d:prop><c:filter><c:comp-filter name="VCALENDAR"><c:comp-filter name="VTODO"/></c:comp-filter></c:filter></c:calendar-query>`);
  assert.doesNotMatch(r.body, /x\.ics/);

  // Sync: initial, then a delete shows up as a 404 with a newer token; a bad token is refused.
  const sync = (token) => call("REPORT", "/dav/calendars/ada@example.com/work/",
    `<d:sync-collection xmlns:d="DAV:"><d:sync-token>${token}</d:sync-token><d:sync-level>1</d:sync-level><d:prop><d:getetag/></d:prop></d:sync-collection>`);
  r = await sync("");
  const token = /<d:sync-token>([^<]+)<\/d:sync-token>/.exec(r.body)[1];
  assert.match(r.body, /x\.ics/);
  assert.equal((await call("DELETE", "/dav/calendars/ada@example.com/work/x.ics", "", { "if-match": '"1"' })).status, 412);
  assert.equal((await call("DELETE", "/dav/calendars/ada@example.com/work/x.ics")).status, 204);
  assert.equal(store.work.size, 0);
  r = await sync(token);
  assert.match(r.body, /x\.ics<\/d:href><d:status>HTTP\/1.1 404/);
  assert.notEqual(/<d:sync-token>([^<]+)<\/d:sync-token>/.exec(r.body)[1], token);
  r = await sync("urn:synergy:sync:999999");
  assert.equal(r.status, 403);
  assert.match(r.body, /valid-sync-token/);
  assert.equal((await call("MKCALENDAR", "/dav/calendars/ada@example.com/new/")).status, 403);
});

test("app password checks are cached, and a guessing address is turned away", async () => {
  let calls = 0;
  const server = http.createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      calls++;
      const b = JSON.parse(body);
      if (req.headers["x-proxy-auth-secret"] !== "s3cret") return res.writeHead(403).end();
      if (b.email === "ada@example.com" && b.password === "abcd-efgh-ijkl-mnop") return res.end(JSON.stringify({ email: "ada@example.com" }));
      res.writeHead(401).end("{}");
    });
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const verify = appPasswordVerifier({ app: "test", authUrl: `http://127.0.0.1:${server.address().port}`, secret: "s3cret", maxFailures: 3 });
  assert.equal(await verify("ada@example.com", "abcd-efgh-ijkl-mnop", "1.1.1.1"), "ada@example.com");
  assert.equal(await verify("ada@example.com", "abcd-efgh-ijkl-mnop", "1.1.1.1"), "ada@example.com");
  assert.equal(calls, 1);
  for (let i = 0; i < 3; i++) assert.equal(await verify("ada@example.com", "guess" + i, "2.2.2.2"), null);
  const before = calls;
  assert.equal(await verify("ada@example.com", "guess-again", "2.2.2.2"), null);
  assert.equal(calls, before, "blocked address doesn't reach the account service");
  assert.equal(await verify("ada@example.com", "nope", "3.3.3.3"), null);
  const noSecret = appPasswordVerifier({ app: "test", authUrl: `http://127.0.0.1:${server.address().port}`, secret: "" });
  assert.equal(await noSecret("ada@example.com", "abcd-efgh-ijkl-mnop", "1.1.1.1"), null);
  server.close();
});
