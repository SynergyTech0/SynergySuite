import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { parseVCards } from "../lib/vcard";

// Runs against a real Postgres when TEST_DATABASE_URL is set (CI sets it); skipped otherwise.
const url = process.env.TEST_DATABASE_URL;
if (url) process.env.DATABASE_URL = url;
delete process.env.DIRECTORY_SCIM_TOKEN;

const alice = "alice@example.com";
const bob = "bob@example.com";
const PNG = Buffer.from("89504e470d0a1a0a0000000d49484452", "hex");

describe.skipIf(!url)("contacts", async () => {
  const contacts = await import("../lib/contacts");
  const directory = await import("../lib/directory");
  const { q, db } = await import("../lib/db");

  beforeAll(async () => {
    await q("SELECT 1");
    await q("TRUNCATE contacts, groups, profiles CASCADE");
  });
  afterAll(async () => {
    await db().close();
  });

  let ada: Awaited<ReturnType<typeof contacts.create>>;

  it("adds, finds and edits a contact", async () => {
    ada = await contacts.create(alice, {
      firstName: "Ada", lastName: "Lovelace", company: "Engines",
      emails: [{ label: "work", value: "ada@example.com" }, { label: "home", value: " " }],
      phones: [{ label: "mobile", value: "+44 (20) 7946-0000" }],
      websites: [{ label: "work", value: "ada.example" }],
    });
    expect(ada.displayName).toBe("Ada Lovelace");
    expect(ada.emails).toEqual([{ label: "work", value: "ada@example.com" }]);
    expect(ada.websites[0].value).toBe("https://ada.example");
    await contacts.create(alice, { company: "Acme Ltd", phones: [{ label: "work", value: "555 0100" }] });

    expect((await contacts.list(alice, { q: "lovel" })).map((c) => c.id)).toEqual([ada.id]);
    expect((await contacts.list(alice, { q: "ada engines" })).length).toBe(1);
    expect((await contacts.list(alice, { q: "7946" })).map((c) => c.id)).toEqual([ada.id]);
    expect((await contacts.list(alice, { q: "100%" })).length).toBe(0);
    // Sorted by last name, with a company-only contact sorted by its name.
    expect((await contacts.list(alice)).map((c) => c.displayName)).toEqual(["Acme Ltd", "Ada Lovelace"]);

    const edited = await contacts.update(alice, ada.id, { ...ada, jobTitle: "Countess", birthday: "1815-12-10" });
    expect(edited.jobTitle).toBe("Countess");
    expect(edited.birthday).toBe("1815-12-10");
  });

  it("refuses bad input", async () => {
    await expect(contacts.create(alice, {})).rejects.toThrow(/name, company, email or phone/);
    await expect(contacts.create(alice, { firstName: "X", emails: [{ label: "work", value: "nope" }] })).rejects.toThrow(/not an email/);
    await expect(contacts.create(alice, { firstName: "X", websites: [{ label: "work", value: "javascript:alert(1)" }] })).rejects.toThrow(/web address/);
    await expect(contacts.create(alice, { firstName: "X", birthday: "2023-02-30" })).rejects.toThrow(/birthday/);
  });

  it("keeps each person's address book to themselves", async () => {
    expect(await contacts.list(bob)).toEqual([]);
    await expect(contacts.get(bob, ada.id)).rejects.toThrow(/not found/);
    await expect(contacts.update(bob, ada.id, { firstName: "Hacked" })).rejects.toThrow(/not found/);
    expect(await contacts.remove(bob, [ada.id])).toBe(0);
    await expect(contacts.setPhoto(bob, ada.id, PNG)).rejects.toThrow(/not found/);
    const bobs = await contacts.createGroup(bob, "Bob's group");
    // Neither side can be mixed: Alice's contact into Bob's group, or Bob into Alice's.
    await expect(contacts.setMembership(alice, bobs.id, [ada.id], true)).rejects.toThrow(/not found/);
    await contacts.setMembership(bob, bobs.id, [ada.id], true);
    expect((await contacts.groups(bob))[0].count).toBe(0);
  });

  it("groups contacts, favorites and photos", async () => {
    const g = await contacts.createGroup(alice, "Friends");
    await expect(contacts.createGroup(alice, "friends")).rejects.toThrow(/already/);
    await contacts.setMembership(alice, g.id, [ada.id], true);
    expect((await contacts.list(alice, { group: g.id })).map((c) => c.id)).toEqual([ada.id]);
    expect((await contacts.groups(alice))[0]).toMatchObject({ name: "Friends", count: 1 });
    await contacts.setFavorite(alice, ada.id, true);
    expect((await contacts.list(alice, { favorites: true })).length).toBe(1);

    await expect(contacts.setPhoto(alice, ada.id, Buffer.from("<svg onload=alert(1)>"))).rejects.toThrow(/JPEG, PNG/);
    await contacts.setPhoto(alice, ada.id, PNG);
    expect((await contacts.photo(alice, ada.id))?.mime).toBe("image/png");
    expect(await contacts.photo(bob, ada.id)).toBeNull();
  });

  it("imports a vCard file, skipping people already there, and exports it again", async () => {
    const vcf = [
      "BEGIN:VCARD\nVERSION:3.0\nFN:Ada Again\nEMAIL:ADA@example.com\nEND:VCARD",
      "BEGIN:VCARD\nVERSION:3.0\nN:Hopper;Grace\nEMAIL:grace@example.com\nCATEGORIES:Friends,Navy\nURL:javascript:alert(1)\nEND:VCARD",
      "BEGIN:VCARD\nVERSION:3.0\nNOTE:nothing else\nEND:VCARD",
    ].join("\n");
    const r = await contacts.importContacts(alice, parseVCards(vcf));
    expect(r).toEqual({ added: 1, skipped: 1, failed: 1 });
    const groups = await contacts.groups(alice);
    expect(groups.map((g) => `${g.name}:${g.count}`)).toEqual(["Friends:2", "Navy:1"]);
    const grace = (await contacts.list(alice, { q: "grace" }))[0];
    expect(grace.websites).toEqual([]);

    const cards = await contacts.exportCards(alice);
    expect(cards.map((c) => c.displayName).sort()).toEqual(["Acme Ltd", "Ada Lovelace", "Grace Hopper"]);
    const adaCard = cards.find((c) => c.uid === ada.id)!;
    expect(adaCard.groups).toEqual(["Friends"]);
    expect(adaCard.photo?.mime).toBe("image/png");
  });

  it("suggests recipients from contacts first, then the directory", async () => {
    await directory.touch("adam@example.com", "Adam Smith");
    await directory.saveProfile("adam@example.com", { name: "Adam Smith", jobTitle: "Economist" });
    const s = await directory.suggest(alice, "ad");
    expect(s[0]).toMatchObject({ email: "ada@example.com", source: "contact" });
    expect(s.find((x) => x.email === "adam@example.com")).toMatchObject({ name: "Adam Smith", source: "directory" });
    // Bob doesn't see Alice's contacts, only the directory.
    expect((await directory.suggest(bob, "ada")).map((x) => x.email)).toEqual(["adam@example.com"]);
  });

  it("lists the directory from profiles when there is no SCIM token", async () => {
    await directory.touch(alice, "Alice");
    const d = await directory.people();
    expect(d.source).toBe("signed-in");
    expect(d.people.map((p) => p.email)).toEqual(["adam@example.com", alice]);
    await expect(directory.saveProfile(alice, { manager: alice })).rejects.toThrow(/own manager/);
    await directory.saveProfile(alice, { name: "Alice A", manager: "adam@example.com" });
    expect((await directory.person(alice)).manager).toBe("adam@example.com");
    expect((await directory.people("econ")).people.map((p) => p.email)).toEqual(["adam@example.com"]);
  });

  it("deletes contacts and their group memberships", async () => {
    expect(await contacts.remove(alice, [ada.id])).toBe(1);
    expect((await contacts.groups(alice)).find((g) => g.name === "Friends")?.count).toBe(1);
  });
});
