import { describe, expect, it } from "vitest";
import { parseContactsCsv, parseCsv, toContactsCsv } from "../lib/csv";
import { displayName } from "../lib/types";
import { parseVCards, toVCard } from "../lib/vcard";

const APPLE = [
  "BEGIN:VCARD",
  "VERSION:3.0",
  "N:Lovelace;Ada;King;;",
  "FN:Ada King Lovelace",
  "ORG:Analytical Engines\\, Ltd;Research",
  "TITLE:Countess",
  "item1.EMAIL;type=INTERNET;type=WORK;type=pref:ada@example.com",
  "EMAIL;TYPE=HOME:ada.home@example.com",
  "TEL;TYPE=CELL:+44 20 7946 0000",
  "TEL;TYPE=WORK,FAX:+44 20 7946 0001",
  "ADR;TYPE=WORK:;;12 St James's Square;London;;SW1Y 4JH;United Kingdom",
  "URL:https://example.com/ada",
  "BDAY:1815-12-10",
  "NOTE:Wrote the first program.\\nLikes poetry; and maths.",
  "CATEGORIES:Friends,Mathematicians",
  "PHOTO;ENCODING=b;TYPE=JPEG:/9j/4AAQSkZJRg",
  " ABAQAAAQABAAD",
  "END:VCARD",
].join("\r\n");

describe("vCard", () => {
  it("reads an Apple / iCloud card with folding, escapes and grouped properties", () => {
    const [c] = parseVCards(APPLE);
    expect(c.firstName).toBe("Ada");
    expect(c.middleName).toBe("King");
    expect(c.lastName).toBe("Lovelace");
    expect(c.company).toBe("Analytical Engines, Ltd");
    expect(c.department).toBe("Research");
    expect(c.jobTitle).toBe("Countess");
    expect(c.emails).toEqual([{ label: "work", value: "ada@example.com" }, { label: "home", value: "ada.home@example.com" }]);
    expect(c.phones).toEqual([{ label: "mobile", value: "+44 20 7946 0000" }, { label: "work fax", value: "+44 20 7946 0001" }]);
    expect(c.addresses[0]).toMatchObject({ label: "work", street: "12 St James's Square", city: "London", postcode: "SW1Y 4JH", country: "United Kingdom" });
    expect(c.birthday).toBe("1815-12-10");
    expect(c.notes).toBe("Wrote the first program.\nLikes poetry; and maths.");
    expect(c.groups).toEqual(["Friends", "Mathematicians"]);
    expect(c.photo?.mime).toBe("image/jpeg");
    expect(c.photo?.data[0]).toBe(0xff);
  });

  it("reads vCard 4.0 and 2.1 cards in one file", () => {
    const src = [
      "BEGIN:VCARD", "VERSION:4.0", "FN:Grace Hopper", "EMAIL;TYPE=work:grace@navy.example", "TEL;VALUE=uri;TYPE=cell:tel:+1-555-0100", "BDAY:--1209", "END:VCARD",
      "BEGIN:VCARD", "VERSION:2.1", "N:Turing;Alan", "TEL;WORK;VOICE:0161 555 0199",
      "NOTE;ENCODING=QUOTED-PRINTABLE;CHARSET=UTF-8:Caf=C3=A9 =",
      "regular", "END:VCARD",
    ].join("\n");
    const [g, a] = parseVCards(src);
    expect(g.firstName).toBe("Grace");
    expect(g.lastName).toBe("Hopper");
    expect(g.phones[0]).toEqual({ label: "mobile", value: "+1-555-0100" });
    expect(g.birthday).toBe("1604-12-09");
    expect(a.lastName).toBe("Turing");
    expect(a.phones[0]).toEqual({ label: "work", value: "0161 555 0199" });
    expect(a.notes).toBe("Café regular");
  });

  it("writes cards that read back the same", () => {
    const [c] = parseVCards(APPLE);
    const out = toVCard({ ...c, displayName: displayName(c), photo: c.photo ?? null });
    expect(out).toMatch(/^BEGIN:VCARD\r\nVERSION:3.0\r\n/);
    expect(out.split("\r\n").every((l) => Buffer.byteLength(l) <= 75)).toBe(true);
    const [back] = parseVCards(out);
    expect({ ...back, photo: undefined }).toEqual({ ...c, photo: undefined });
    expect(back.photo?.data.equals(c.photo!.data)).toBe(true);
  });

  it("writes a birthday without a year the way address books expect", () => {
    const out = toVCard({ ...parseVCards("BEGIN:VCARD\nFN:X\nBDAY:--0704\nEND:VCARD")[0], displayName: "X" });
    expect(out).toContain("BDAY:--0704");
  });
});

describe("CSV", () => {
  it("parses quoted fields with commas, quotes and newlines", () => {
    expect(parseCsv('a,b\r\n"x, y","say ""hi""\nthere"\n')).toEqual([["a", "b"], ["x, y", 'say "hi"\nthere']]);
  });

  it("reads a Google Contacts export", () => {
    const src = [
      "First Name,Middle Name,Last Name,Nickname,Birthday,Notes,Labels,E-mail 1 - Label,E-mail 1 - Value,E-mail 2 - Label,E-mail 2 - Value,Phone 1 - Label,Phone 1 - Value,Address 1 - Label,Address 1 - Street,Address 1 - City,Address 1 - Postal Code,Address 1 - Country,Organization Name,Organization Title,Website 1 - Label,Website 1 - Value",
      'Ada,,Lovelace,,--12-10,Hi,* myContacts ::: Family,* Work,ada@example.com ::: ada2@example.com,Home,ada.home@example.com,Mobile,+44 1,Work,"12 Square",London,SW1,UK,Engines,Countess,Profile,https://ada.example',
    ].join("\n");
    const [c] = parseContactsCsv(src);
    expect(c.firstName).toBe("Ada");
    expect(c.emails.map((e) => e.value)).toEqual(["ada@example.com", "ada2@example.com", "ada.home@example.com"]);
    expect(c.emails[0].label).toBe("work");
    expect(c.phones).toEqual([{ label: "mobile", value: "+44 1" }]);
    expect(c.addresses[0]).toMatchObject({ street: "12 Square", city: "London", country: "UK" });
    expect(c.company).toBe("Engines");
    expect(c.jobTitle).toBe("Countess");
    expect(c.birthday).toBe("1604-12-10");
    expect(c.groups).toEqual(["Family"]);
  });

  it("reads an Outlook export and round-trips its own export", () => {
    const src = 'First Name,Last Name,E-mail Address,Mobile Phone,Business Phone,Company,Business Street,Business City,Birthday,Categories\nAlan,Turing,alan@example.com,07700 900000,0161 555,Bletchley,"Hut 8",Milton Keynes,6/23/1912,Codebreakers;Friends\n';
    const [c] = parseContactsCsv(src);
    expect(c).toMatchObject({ firstName: "Alan", lastName: "Turing", company: "Bletchley", birthday: "1912-06-23", groups: ["Codebreakers", "Friends"] });
    expect(c.phones).toEqual([{ label: "mobile", value: "07700 900000" }, { label: "work", value: "0161 555" }]);
    const [back] = parseContactsCsv(toContactsCsv([{ ...c, displayName: displayName(c) }]));
    expect(back).toMatchObject({ firstName: "Alan", lastName: "Turing", birthday: "1912-06-23", groups: ["Codebreakers", "Friends"] });
    expect(back.emails).toEqual([{ label: "work", value: "alan@example.com" }]);
    expect(back.addresses[0]).toMatchObject({ street: "Hut 8", city: "Milton Keynes" });
  });
});
