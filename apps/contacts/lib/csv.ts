// CSV in from Google Contacts and Outlook; out in Outlook's layout, which Google, Apple and Outlook all import.
import { EMPTY_CONTACT, type Address } from "./types";
import type { CardOut, ParsedContact } from "./vcard";

/** RFC 4180: quoted fields, doubled quotes, newlines inside quotes. */
export function parseCsv(src: string): string[][] {
  const s = src.replace(/^﻿/, "");
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (quoted) {
      if (c === '"' && s[i + 1] === '"') {
        field += '"';
        i++;
      } else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && s[i + 1] === "\n") i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else field += c;
  }
  if (field || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.some((f) => f.trim() !== ""));
}

function csvField(v: string): string {
  return /[",\r\n]/.test(v) || /^\s|\s$/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

function date(v: string): string {
  const s = v.trim();
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}`;
  m = s.match(/^--(\d{2})-(\d{2})$/); // Google's birthday without a year
  if (m) return `1604-${m[1]}-${m[2]}`;
  m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/); // Outlook writes month/day/year
  if (m && m[3] !== "0000") return `${m[3]}-${m[1].padStart(2, "0")}-${m[2].padStart(2, "0")}`;
  return "";
}

function label(raw: string): string {
  const l = raw.replace(/^\*\s*/, "").trim().toLowerCase();
  if (!l) return "other";
  if (l === "cell" || l === "mobile") return "mobile";
  return l;
}

/** Google writes several values in one cell joined by " ::: ". */
const many = (v: string) => v.split(" ::: ").map((s) => s.trim()).filter(Boolean);

const OUTLOOK_PHONES: [string, string][] = [
  ["Mobile Phone", "mobile"], ["Business Phone", "work"], ["Business Phone 2", "work"], ["Home Phone", "home"],
  ["Home Phone 2", "home"], ["Primary Phone", "main"], ["Company Main Phone", "main"], ["Other Phone", "other"],
  ["Business Fax", "work fax"], ["Home Fax", "home fax"], ["Pager", "pager"],
];

export function parseContactsCsv(src: string): ParsedContact[] {
  const rows = parseCsv(src);
  if (rows.length < 2) return [];
  const head = rows[0].map((h) => h.trim());
  const out: ParsedContact[] = [];
  for (const r of rows.slice(1)) {
    const get = (name: string) => {
      const i = head.findIndex((h) => h.toLowerCase() === name.toLowerCase());
      return i >= 0 ? (r[i] ?? "").trim() : "";
    };
    const c: ParsedContact = { ...EMPTY_CONTACT, emails: [], phones: [], addresses: [], websites: [], groups: [] };
    c.firstName = get("First Name") || get("Given Name");
    c.middleName = get("Middle Name") || get("Additional Name");
    c.lastName = get("Last Name") || get("Family Name");
    c.nickname = get("Nickname");
    c.company = get("Company") || get("Organization Name") || get("Organization 1 - Name");
    c.jobTitle = get("Job Title") || get("Organization Title") || get("Organization 1 - Title");
    c.department = get("Department") || get("Organization Department") || get("Organization 1 - Department");
    c.birthday = date(get("Birthday"));
    c.notes = get("Notes");
    if (!c.firstName && !c.lastName && get("Name")) {
      const words = get("Name").split(/\s+/);
      c.firstName = words.length > 1 ? words.slice(0, -1).join(" ") : words[0];
      c.lastName = words.length > 1 ? words[words.length - 1] : "";
    }

    // Google: "E-mail 1 - Label" / "E-mail 1 - Value" (older exports say "Type"), and the same for phones, addresses, websites.
    for (let n = 1; n <= 10; n++) {
      const kind = (k: string) => get(`${k} ${n} - Label`) || get(`${k} ${n} - Type`);
      for (const v of many(get(`E-mail ${n} - Value`))) c.emails.push({ label: label(kind("E-mail")), value: v });
      for (const v of many(get(`Phone ${n} - Value`))) c.phones.push({ label: label(kind("Phone")), value: v });
      for (const v of many(get(`Website ${n} - Value`))) c.websites.push({ label: label(kind("Website")), value: v });
      const street = get(`Address ${n} - Street`);
      const city = get(`Address ${n} - City`);
      const region = get(`Address ${n} - Region`);
      const postcode = get(`Address ${n} - Postal Code`);
      const country = get(`Address ${n} - Country`);
      if (street || city || region || postcode || country) c.addresses.push({ label: label(kind("Address")), street, city, region, postcode, country });
    }
    const groups = get("Labels") || get("Group Membership") || get("Categories");
    for (const g of groups.split(/ ::: |;/)) {
      const name = g.replace(/^\*\s*/, "").trim();
      if (name && !/^(myContacts|My Contacts|starred)$/i.test(name)) c.groups.push(name);
    }

    // Outlook
    for (const key of ["E-mail Address", "E-mail 2 Address", "E-mail 3 Address"]) {
      const v = get(key);
      if (v && !c.emails.some((e) => e.value === v)) c.emails.push({ label: key === "E-mail Address" ? "work" : "other", value: v });
    }
    for (const [key, l] of OUTLOOK_PHONES) {
      const v = get(key);
      if (v && !c.phones.some((p) => p.value === v)) c.phones.push({ label: l, value: v });
    }
    for (const [prefix, l] of [["Business", "work"], ["Home", "home"], ["Other", "other"]] as const) {
      const a: Address = {
        label: l,
        street: [get(`${prefix} Street`), get(`${prefix} Street 2`), get(`${prefix} Street 3`)].filter(Boolean).join("\n"),
        city: get(`${prefix} City`),
        region: get(`${prefix} State`),
        postcode: get(`${prefix} Postal Code`),
        country: get(`${prefix} Country/Region`) || get(`${prefix} Country`),
      };
      if (a.street || a.city || a.region || a.postcode || a.country) c.addresses.push(a);
    }
    const web = get("Web Page");
    if (web && !c.websites.some((w) => w.value === web)) c.websites.push({ label: "work", value: web });

    if (c.firstName || c.lastName || c.company || c.emails.length || c.phones.length) out.push(c);
  }
  return out;
}

const HEAD = [
  "First Name", "Middle Name", "Last Name", "Nickname", "Company", "Department", "Job Title",
  "E-mail Address", "E-mail 2 Address", "E-mail 3 Address",
  "Mobile Phone", "Business Phone", "Home Phone", "Other Phone", "Business Fax",
  "Business Street", "Business City", "Business State", "Business Postal Code", "Business Country/Region",
  "Home Street", "Home City", "Home State", "Home Postal Code", "Home Country/Region",
  "Web Page", "Birthday", "Notes", "Categories",
];

export function toContactsCsv(list: CardOut[]): string {
  const rows = [HEAD.map(csvField).join(",")];
  for (const c of list) {
    const phone = (l: string) => c.phones.find((p) => p.label === l)?.value ?? "";
    const other = c.phones.filter((p) => !["mobile", "work", "home", "work fax"].includes(p.label)).map((p) => p.value).join(", ");
    const adr = (l: string) => c.addresses.find((a) => a.label === l) ?? (l === "work" ? c.addresses.find((a) => a.label !== "home") : undefined);
    const work = adr("work");
    const home = adr("home");
    const bday = c.birthday && !c.birthday.startsWith("1604-") ? `${+c.birthday.slice(5, 7)}/${+c.birthday.slice(8)}/${c.birthday.slice(0, 4)}` : "";
    const row = [
      c.firstName, c.middleName, c.lastName, c.nickname, c.company, c.department, c.jobTitle,
      c.emails[0]?.value ?? "", c.emails[1]?.value ?? "", c.emails[2]?.value ?? "",
      phone("mobile"), phone("work"), phone("home"), other, phone("work fax"),
      work?.street ?? "", work?.city ?? "", work?.region ?? "", work?.postcode ?? "", work?.country ?? "",
      home?.street ?? "", home?.city ?? "", home?.region ?? "", home?.postcode ?? "", home?.country ?? "",
      c.websites[0]?.value ?? "", bday, c.notes, c.groups.join(";"),
    ];
    rows.push(row.map(csvField).join(","));
  }
  return rows.join("\r\n") + "\r\n";
}
