import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDb } from "@synergy/db";
import type { PolicyClient } from "@synergy/compliance";

// CardDAV against a real Postgres when TEST_DATABASE_URL is set, in a database of its own next to
// that one ("<name>_carddav"). App passwords are checked by a stand-in for the account service.
const base = process.env.TEST_DATABASE_URL;
delete process.env.DIRECTORY_SCIM_TOKEN;

async function ownDatabase(url: string): Promise<string> {
  const u = new URL(url);
  const name = `${u.pathname.slice(1)}_carddav`;
  const admin = createDb({ connectionString: url, max: 1 });
  if (!(await admin.q("SELECT 1 FROM pg_database WHERE datname = $1", [name])).rowCount) await admin.q(`CREATE DATABASE "${name}"`);
  await admin.close();
  u.pathname = `/${name}`;
  return u.toString();
}

const alice = "alice@example.com";
const bob = "bob@example.com";
const PASSWORDS: Record<string, string> = { [alice]: "aaaa-bbbb-cccc-dddd", [bob]: "eeee-ffff-gggg-hhhh" };
const PNG = Buffer.from("89504e470d0a1a0a0000000d49484452", "hex");
const noHolds: PolicyClient = { onHold: async () => false, retention: async () => [], retentionDays: async () => null, invalidate() {} };

describe.skipIf(!base)("carddav", async () => {
  if (base) process.env.DATABASE_URL = await ownDatabase(base);
  const contacts = await import("../lib/contacts");
  const { carddav } = await import("../lib/dav");
  const { setPolicy } = await import("../lib/compliance");
  const { q, db } = await import("../lib/db");
  const dav = carddav(async (u, p) => (PASSWORDS[u] === p ? u : null));

  const call = async (method: string, url: string, opts: { body?: string; as?: string; password?: string; headers?: Record<string, string> } = {}) => {
    const as = opts.as ?? alice;
    const auth = "Basic " + Buffer.from(`${as}:${opts.password ?? PASSWORDS[as]}`).toString("base64");
    return dav.handle({ method, url, headers: { authorization: auth, ...opts.headers }, body: opts.body ?? "", ip: "127.0.0.1" });
  };
  const book = `/dav/addressbooks/${alice}/contacts/`;
  const syncToken = (t: string) => /<d:sync-token>([^<]+)<\/d:sync-token>/.exec(t)?.[1] ?? "";
  const sync = async (token: string) =>
    (await call("REPORT", book, { body: `<d:sync-collection xmlns:d="DAV:"><d:sync-token>${token}</d:sync-token><d:sync-level>1</d:sync-level><d:prop><d:getetag/></d:prop></d:sync-collection>` })).body;
  const card = (fn: string, extra: string[] = []) => [
    "BEGIN:VCARD", "VERSION:4.0", "UID:urn:uuid:phone-card-1", `FN:${fn}`, `N:${fn.split(" ")[1] ?? ""};${fn.split(" ")[0]};;;`,
    "EMAIL;TYPE=work:grace@example.com", "TEL;TYPE=cell:+1 555 0100", "X-PHONETIC-FIRST-NAME:Gray-s", "item1.URL:https://grace.example", "item1.X-ABLabel:site",
    ...extra, "END:VCARD", "",
  ].join("\r\n");

  beforeAll(async () => {
    setPolicy(noHolds);
    await q("SELECT 1");
    await q("TRUNCATE contacts, groups, profiles, contact_tombstones CASCADE");
  });
  afterAll(async () => {
    setPolicy(undefined);
    await db().close();
  });

  it("finds the address book from the server name", async () => {
    expect((await call("PROPFIND", "/.well-known/carddav")).status).toBe(301);
    expect((await call("PROPFIND", "/dav/", { password: "wrong" })).status).toBe(401);
    const root = await call("PROPFIND", "/", { headers: { depth: "0" }, body: '<propfind xmlns="DAV:"><prop><current-user-principal/></prop></propfind>' });
    expect(root.body).toContain(`/dav/principals/${alice}/`);
    const pr = await call("PROPFIND", `/dav/principals/${alice}/`, { headers: { depth: "0" }, body: '<propfind xmlns="DAV:" xmlns:A="urn:ietf:params:xml:ns:carddav"><prop><A:addressbook-home-set/></prop></propfind>' });
    expect(pr.body).toContain(`<d:href>/dav/addressbooks/${alice}/</d:href>`);
    const home = await call("PROPFIND", `/dav/addressbooks/${alice}/`, { headers: { depth: "1" }, body: '<propfind xmlns="DAV:"><prop><displayname/><resourcetype/></prop></propfind>' });
    expect(home.body).toContain("<d:displayname>Contacts</d:displayname>");
    expect(home.body).toMatch(/addressbook\/>/);
    expect((await call("PROPFIND", `/dav/addressbooks/${bob}/contacts/`)).status).toBe(403);
  });

  let token = "";
  let id = "";
  it("a card from the phone shows in the web app, with what isn't modeled kept", async () => {
    token = syncToken(await sync(""));
    const put = await call("PUT", `${book}phone-card-1.vcf`, { body: card("Grace Hopper", ["CATEGORIES:Navy,Friends"]), headers: { "if-none-match": "*" } });
    expect(put.status).toBe(201);
    const [grace] = await contacts.list(alice, { q: "hopper" });
    expect(grace.displayName).toBe("Grace Hopper");
    expect(grace.emails).toEqual([{ label: "work", value: "grace@example.com" }]);
    expect(grace.phones).toEqual([{ label: "mobile", value: "+1 555 0100" }]);
    expect((await contacts.groups(alice)).map((g) => [g.name, g.count])).toEqual([["Friends", 1], ["Navy", 1]]);
    id = grace.id;
    const got = await call("GET", `${book}phone-card-1.vcf`);
    expect(got.body).toContain("UID:phone-card-1");
    expect(got.body).toContain("X-PHONETIC-FIRST-NAME:Gray-s");
    expect(got.body).toContain("CATEGORIES:Friends,Navy");
    expect(await sync(token)).toContain("phone-card-1.vcf");
    // The same UID under another name is refused.
    expect((await call("PUT", `${book}other.vcf`, { body: card("Grace Hopper") })).status).toBe(409);
  });

  it("edits in the web app sync back; stale ETags are refused", async () => {
    token = syncToken(await sync(token));
    await contacts.update(alice, id, { firstName: "Grace", lastName: "Hopper", jobTitle: "Rear Admiral", emails: [{ label: "work", value: "grace@example.com" }] });
    let changed = await sync(token);
    expect(changed).toContain("phone-card-1.vcf");
    token = syncToken(changed);
    // Joining a group changes the card too (its CATEGORIES).
    const team = await contacts.createGroup(alice, "Compilers");
    await contacts.setMembership(alice, team.id, [id], true);
    changed = await sync(token);
    expect(changed).toContain("phone-card-1.vcf");
    token = syncToken(changed);
    const got = await call("GET", `${book}phone-card-1.vcf`);
    expect(got.body).toContain("TITLE:Rear Admiral");
    expect(got.body).toContain("CATEGORIES:Compilers,Friends,Navy");
    const etag = got.headers.etag;
    expect((await call("PUT", `${book}phone-card-1.vcf`, { body: card("Grace B Hopper"), headers: { "if-match": '"1"' } })).status).toBe(412);
    // A card without CATEGORIES leaves the groups alone; a photo comes in.
    const photo = `PHOTO;ENCODING=b;TYPE=PNG:${PNG.toString("base64")}`;
    expect((await call("PUT", `${book}phone-card-1.vcf`, { body: card("Grace Brewster", [photo]), headers: { "if-match": etag } })).status).toBe(204);
    const after = await contacts.get(alice, id);
    expect(after.firstName).toBe("Grace");
    expect(after.lastName).toBe("Brewster");
    expect(after.hasPhoto).toBe(true);
    expect(after.groups.length).toBe(3);
  });

  it("multiget and query return the cards", async () => {
    await contacts.create(alice, { firstName: "Ada", lastName: "Lovelace", emails: [{ label: "home", value: "ada@example.com" }] });
    const all = await call("REPORT", book, { headers: { depth: "1" }, body: '<C:addressbook-query xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:carddav"><D:prop><D:getetag/><C:address-data/></D:prop></C:addressbook-query>' });
    expect(all.body).toContain("FN:Ada Lovelace");
    expect(all.body).toContain("FN:Grace Brewster");
    const m = await call("REPORT", book, { body: `<C:addressbook-multiget xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:carddav"><D:prop><D:getetag/><C:address-data/></D:prop><D:href>${book}phone-card-1.vcf</D:href><D:href>${book}nope.vcf</D:href></C:addressbook-multiget>` });
    expect(m.body).toContain("BEGIN:VCARD");
    expect(m.body).toMatch(/nope\.vcf<\/d:href><d:status>HTTP\/1.1 404/);
    expect((await call("PUT", `${book}empty.vcf`, { body: "BEGIN:VCARD\r\nVERSION:3.0\r\nEND:VCARD\r\n" })).status).toBe(403);
    expect((await call("PUT", `${book}junk.vcf`, { body: "hello" })).status).toBe(415);
  });

  it("deletes go both ways", async () => {
    token = syncToken(await sync(token));
    expect((await call("DELETE", `${book}phone-card-1.vcf`)).status).toBe(204);
    expect(await contacts.list(alice, { q: "grace" })).toEqual([]);
    expect(await sync(token)).toMatch(/phone-card-1\.vcf<\/d:href><d:status>HTTP\/1.1 404/);
    token = syncToken(await sync(token));
    const [ada] = await contacts.list(alice, { q: "ada" });
    await contacts.remove(alice, [ada.id]);
    expect(await sync(token)).toMatch(new RegExp(`${ada.id}\\.vcf</d:href><d:status>HTTP/1.1 404`));
    expect((await call("REPORT", book, { body: '<d:sync-collection xmlns:d="DAV:"><d:sync-token>urn:synergy:sync:99999999</d:sync-token><d:prop/></d:sync-collection>' })).status).toBe(403);
  });
});
