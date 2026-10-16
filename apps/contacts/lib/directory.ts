import { q } from "./db";
import { sniffImage } from "./contacts";
import type { Person } from "./types";
import { UserError, text } from "./util";

/**
 * The organization directory: everyone with a suite account, from the sign-in service's SCIM API,
 * with the profile each person keeps here (title, phones, photo). Without a SCIM token the
 * directory falls back to people who have opened Contacts at least once.
 */

type Account = { email: string; name: string };
const cache: { at: number; accounts: Account[] | null } = { at: 0, accounts: null };
const TTL = 5 * 60 * 1000;

async function accounts(): Promise<Account[] | null> {
  const token = process.env.DIRECTORY_SCIM_TOKEN;
  if (!token) return null;
  if (cache.accounts && Date.now() - cache.at < TTL) return cache.accounts;
  const base = (process.env.AUTH_INTERNAL_URL || "http://auth:3500").replace(/\/$/, "");
  try {
    const out: Account[] = [];
    for (let start = 1; start < 20000; start += 200) {
      const res = await fetch(`${base}/api/scim/v2/Users?startIndex=${start}&count=200`, {
        headers: { Authorization: `Bearer ${token}`, Accept: "application/scim+json" },
        signal: AbortSignal.timeout(5000),
      });
      if (!res.ok) throw new Error(`SCIM ${res.status}`);
      const page = (await res.json()) as { totalResults: number; Resources?: { userName: string; active?: boolean; name?: { formatted?: string } }[] };
      for (const u of page.Resources ?? []) {
        if (u.active === false || !u.userName) continue;
        out.push({ email: u.userName.toLowerCase(), name: u.name?.formatted && u.name.formatted !== u.userName ? u.name.formatted : "" });
      }
      if (!page.Resources?.length || start + 200 > page.totalResults) break;
    }
    cache.accounts = out;
    cache.at = Date.now();
    return out;
  } catch (e) {
    console.error("[contacts] directory lookup failed:", (e as Error).message);
    return cache.accounts; // the last good list, or the signed-in fallback
  }
}

type ProfileRow = {
  email: string; name: string; job_title: string; department: string; office: string; phone: string;
  mobile: string; manager: string; about: string; has_photo: boolean;
};

const PCOLS = `email, name, job_title, department, office, phone, mobile, manager, about, photo IS NOT NULL AS has_photo`;

function guessName(email: string): string {
  return email.split("@")[0].replace(/[._-]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function toPerson(email: string, account: Account | undefined, p: ProfileRow | undefined): Person {
  return {
    email,
    name: p?.name || account?.name || guessName(email),
    jobTitle: p?.job_title ?? "", department: p?.department ?? "", office: p?.office ?? "",
    phone: p?.phone ?? "", mobile: p?.mobile ?? "", manager: p?.manager ?? "", about: p?.about ?? "",
    hasPhoto: p?.has_photo ?? false,
  };
}

const seen = new Map<string, number>();

/** Records that someone has used Contacts, so the fallback directory knows them. At most once an hour each. */
export async function touch(email: string, name: string): Promise<void> {
  const last = seen.get(email) ?? 0;
  if (Date.now() - last < 3600_000) return;
  const clean = name && name !== email ? text(name, 200) : "";
  await q(
    `INSERT INTO profiles (email, name) VALUES ($1, $2)
     ON CONFLICT (email) DO UPDATE SET last_seen = now(), name = CASE WHEN profiles.name = '' THEN EXCLUDED.name ELSE profiles.name END`,
    [email, clean],
  );
  seen.set(email, Date.now());
}

export async function people(search = "", me?: { email: string; name: string }): Promise<{ people: Person[]; source: "accounts" | "signed-in" }> {
  const list = await accounts();
  let profiles = await q<ProfileRow>(`SELECT ${PCOLS} FROM profiles`);
  if (!list && me && !profiles.some((p) => p.email === me.email)) {
    // You are always in the list you are looking at.
    seen.delete(me.email);
    await touch(me.email, me.name);
    profiles = await q<ProfileRow>(`SELECT ${PCOLS} FROM profiles`);
  }
  const byEmail = new Map(profiles.map((p) => [p.email, p]));
  let out: Person[];
  if (list) out = list.map((a) => toPerson(a.email, a, byEmail.get(a.email)));
  else out = profiles.map((p) => toPerson(p.email, undefined, p));
  const words = search.toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length) {
    out = out.filter((p) => {
      const hay = [p.name, p.email, p.jobTitle, p.department, p.office].join(" ").toLowerCase();
      return words.every((w) => hay.includes(w));
    });
  }
  out.sort((a, b) => a.name.localeCompare(b.name));
  return { people: out, source: list ? "accounts" : "signed-in" };
}

export async function person(email: string): Promise<Person> {
  const e = email.toLowerCase();
  const list = await accounts();
  const account = list?.find((a) => a.email === e);
  const [p] = await q<ProfileRow>(`SELECT ${PCOLS} FROM profiles WHERE email = $1`, [e]);
  if (list ? !account : !p) throw new UserError("Nobody in the directory has that address", 404);
  return toPerson(e, account, p);
}

export type ProfileInput = Pick<Person, "name" | "jobTitle" | "department" | "office" | "phone" | "mobile" | "manager" | "about">;

export async function saveProfile(email: string, v: Partial<ProfileInput>): Promise<Person> {
  const manager = text(v.manager, 254).toLowerCase();
  if (manager && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(manager)) throw new UserError("Enter your manager's email address");
  if (manager === email) throw new UserError("You can't be your own manager");
  await q(
    `INSERT INTO profiles (email, name, job_title, department, office, phone, mobile, manager, about, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, now())
     ON CONFLICT (email) DO UPDATE SET name = $2, job_title = $3, department = $4, office = $5, phone = $6,
       mobile = $7, manager = $8, about = $9, updated_at = now()`,
    [email, text(v.name, 200), text(v.jobTitle, 200), text(v.department, 200), text(v.office, 200),
      text(v.phone, 50), text(v.mobile, 50), manager, text(v.about, 2000)],
  );
  const [p] = await q<ProfileRow>(`SELECT ${PCOLS} FROM profiles WHERE email = $1`, [email]);
  return toPerson(email, (await accounts())?.find((a) => a.email === email), p);
}

export async function setProfilePhoto(email: string, data: Buffer | null): Promise<void> {
  let mime: string | null = null;
  if (data) {
    mime = sniffImage(data);
    if (!mime) throw new UserError("Pick a JPEG, PNG, GIF or WebP image");
  }
  await q(
    `INSERT INTO profiles (email, photo, photo_mime) VALUES ($1, $2, $3)
     ON CONFLICT (email) DO UPDATE SET photo = $2, photo_mime = $3, updated_at = now()`,
    [email, data, mime],
  );
}

export async function profilePhoto(email: string): Promise<{ mime: string; data: Buffer } | null> {
  const [row] = await q<{ photo: Buffer | null; photo_mime: string | null }>(`SELECT photo, photo_mime FROM profiles WHERE email = $1`, [email.toLowerCase()]);
  return row?.photo ? { mime: row.photo_mime || "image/jpeg", data: row.photo } : null;
}

/** For Mail's To box: the person's own contacts first, then the directory. */
export async function suggest(owner: string, search: string, limit = 8): Promise<{ name: string; email: string; source: "contact" | "directory" }[]> {
  const s = search.trim().toLowerCase();
  if (!s) return [];
  const like = `%${s.replace(/[\\%_]/g, (m) => "\\" + m)}%`;
  const rows = await q<{ name: string; email: string }>(
    `SELECT c.display AS name, e->>'value' AS email
     FROM contacts c, jsonb_array_elements(c.emails) e
     WHERE c.owner = $1 AND c.held_deleted_at IS NULL AND (c.display ILIKE $2 OR c.nickname ILIKE $2 OR e->>'value' ILIKE $2)
     ORDER BY c.favorite DESC, (c.display ILIKE $3 OR e->>'value' ILIKE $3) DESC, c.sort_key LIMIT $4`,
    [owner, like, `${s.replace(/[\\%_]/g, (m) => "\\" + m)}%`, limit],
  );
  const out: { name: string; email: string; source: "contact" | "directory" }[] = rows.map((r) => ({ ...r, source: "contact" }));
  const have = new Set(out.map((r) => r.email.toLowerCase()));
  if (out.length < limit) {
    const dir = await people(search);
    for (const p of dir.people) {
      if (out.length >= limit) break;
      if (have.has(p.email)) continue;
      out.push({ name: p.name, email: p.email, source: "directory" });
    }
  }
  return out;
}
