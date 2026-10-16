import { policy } from "./compliance";
import { q, tx } from "./db";
import { displayName, type Address, type Contact, type ContactInput, type Group, type Labeled } from "./types";
import { UserError, text } from "./util";
import type { CardOut, ParsedContact } from "./vcard";

const MAX_LIST = 20;
const PHOTO_MAX = 2 * 1024 * 1024;

type Row = {
  id: string; first_name: string; middle_name: string; last_name: string; nickname: string; company: string;
  job_title: string; department: string; emails: Labeled[]; phones: Labeled[]; addresses: Address[]; websites: Labeled[];
  birthday: string | null; notes: string; display: string; favorite: boolean; has_photo: boolean; groups: string[] | null;
  created_at: Date; modified_at: Date;
};

const COLS = `c.id, c.first_name, c.middle_name, c.last_name, c.nickname, c.company, c.job_title, c.department,
  c.emails, c.phones, c.addresses, c.websites, to_char(c.birthday, 'YYYY-MM-DD') AS birthday, c.notes, c.display,
  c.favorite, c.photo IS NOT NULL AS has_photo, c.created_at, c.modified_at,
  (SELECT array_agg(gm.group_id::text) FROM group_members gm WHERE gm.contact_id = c.id) AS groups`;

function toContact(r: Row): Contact {
  return {
    id: r.id, firstName: r.first_name, middleName: r.middle_name, lastName: r.last_name, nickname: r.nickname,
    company: r.company, jobTitle: r.job_title, department: r.department, emails: r.emails, phones: r.phones,
    addresses: r.addresses, websites: r.websites, birthday: r.birthday ?? "", notes: r.notes, displayName: r.display,
    favorite: r.favorite, hasPhoto: r.has_photo, groups: r.groups ?? [],
    createdAt: r.created_at.toISOString(), modifiedAt: r.modified_at.toISOString(),
  };
}

function labeled(v: unknown, max: number, check?: (s: string) => string): Labeled[] {
  if (!Array.isArray(v)) return [];
  const out: Labeled[] = [];
  for (const item of v.slice(0, MAX_LIST)) {
    let value = text((item as Labeled)?.value, max);
    if (!value) continue;
    if (check) value = check(value);
    out.push({ label: text((item as Labeled)?.label, 40).toLowerCase() || "other", value });
  }
  return out;
}

function email(v: string): string {
  const s = v.replace(/^mailto:/i, "").trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s)) throw new UserError(`"${v}" is not an email address`);
  return s;
}

function website(v: string): string {
  const s = /^[a-z][a-z0-9+.-]*:/i.test(v) ? v : `https://${v}`;
  // Only web links: a javascript: URL would run when someone clicks it.
  if (!/^https?:\/\//i.test(s)) throw new UserError(`"${v}" is not a web address`);
  return s;
}

function day(v: unknown): string {
  const s = text(v, 10);
  if (!s) return "";
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  const d = m && new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  if (!m || !d || d.getUTCMonth() !== +m[2] - 1 || d.getUTCDate() !== +m[3]) throw new UserError("Enter the birthday as a date");
  return s;
}

/** Checks and tidies what the browser or an import sent. */
export function clean(v: Partial<ContactInput>): ContactInput {
  const addresses: Address[] = [];
  for (const a of Array.isArray(v.addresses) ? v.addresses.slice(0, MAX_LIST) : []) {
    const x: Address = {
      label: text(a?.label, 40).toLowerCase() || "other",
      street: text(a?.street, 300), city: text(a?.city, 100), region: text(a?.region, 100),
      postcode: text(a?.postcode, 30), country: text(a?.country, 100),
    };
    if (x.street || x.city || x.region || x.postcode || x.country) addresses.push(x);
  }
  const c: ContactInput = {
    firstName: text(v.firstName, 100), middleName: text(v.middleName, 100), lastName: text(v.lastName, 100),
    nickname: text(v.nickname, 100), company: text(v.company, 200), jobTitle: text(v.jobTitle, 200),
    department: text(v.department, 200),
    emails: labeled(v.emails, 254, email), phones: labeled(v.phones, 50), addresses,
    websites: labeled(v.websites, 500, website), birthday: day(v.birthday), notes: text(v.notes, 10000),
  };
  if (!c.firstName && !c.lastName && !c.nickname && !c.company && !c.emails.length && !c.phones.length) {
    throw new UserError("Give the contact a name, company, email or phone number");
  }
  return c;
}

/** "Lovelace Ada" sorts by last name; a contact with no name sorts by what it shows. */
function sortKey(c: ContactInput, display: string): string {
  return (c.lastName ? `${c.lastName} ${c.firstName}` : display).toLowerCase();
}

function searchText(c: ContactInput, display: string): string {
  return [display, c.nickname, c.company, c.jobTitle, c.department, ...c.emails.map((e) => e.value), ...c.phones.map((p) => p.value.replace(/\D/g, "")),
    ...c.addresses.map((a) => `${a.city} ${a.country}`)].join(" ").toLowerCase();
}

function fields(c: ContactInput) {
  const display = displayName(c);
  return [c.firstName, c.middleName, c.lastName, c.nickname, c.company, c.jobTitle, c.department,
    JSON.stringify(c.emails), JSON.stringify(c.phones), JSON.stringify(c.addresses), JSON.stringify(c.websites),
    c.birthday || null, c.notes, display, sortKey(c, display), searchText(c, display)];
}

export type ListOpts = { q?: string; group?: string; favorites?: boolean };

export async function list(owner: string, opts: ListOpts = {}): Promise<Contact[]> {
  const where = ["c.owner = $1", "c.held_deleted_at IS NULL"];
  const params: unknown[] = [owner];
  if (opts.q?.trim()) {
    const words = opts.q.trim().toLowerCase().split(/\s+/).slice(0, 6);
    for (const w of words) {
      params.push(`%${w.replace(/[\\%_]/g, (m) => "\\" + m)}%`);
      const digits = w.replace(/\D/g, "");
      if (digits.length >= 3 && digits.length === w.replace(/[\s()+.-]/g, "").length) {
        params.push(`%${digits}%`);
        where.push(`(c.search LIKE $${params.length - 1} OR c.search LIKE $${params.length})`);
      } else where.push(`c.search LIKE $${params.length}`);
    }
  }
  if (opts.group) {
    params.push(opts.group);
    where.push(`EXISTS (SELECT 1 FROM group_members gm WHERE gm.contact_id = c.id AND gm.group_id = $${params.length}::uuid)`);
  }
  if (opts.favorites) where.push("c.favorite");
  const rows = await q<Row>(`SELECT ${COLS} FROM contacts c WHERE ${where.join(" AND ")} ORDER BY c.sort_key, c.id LIMIT 5000`, params);
  return rows.map(toContact);
}

export async function get(owner: string, id: string): Promise<Contact> {
  const [row] = await q<Row>(`SELECT ${COLS} FROM contacts c WHERE c.id = $1::uuid AND c.owner = $2 AND c.held_deleted_at IS NULL`, [id, owner]);
  if (!row) throw new UserError("Contact not found", 404);
  return toContact(row);
}

export async function create(owner: string, input: Partial<ContactInput>, groupIds: string[] = []): Promise<Contact> {
  const c = clean(input);
  const id = await tx(async (tq) => {
    const [row] = await tq<{ id: string }>(
      `INSERT INTO contacts (owner, first_name, middle_name, last_name, nickname, company, job_title, department,
         emails, phones, addresses, websites, birthday, notes, display, sort_key, search)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17) RETURNING id`,
      [owner, ...fields(c)],
    );
    await addToGroups(tq, owner, [row.id], groupIds);
    return row.id;
  });
  return get(owner, id);
}

export async function update(owner: string, id: string, input: Partial<ContactInput>): Promise<Contact> {
  const c = clean(input);
  const rows = await q(
    `UPDATE contacts SET first_name = $3, middle_name = $4, last_name = $5, nickname = $6, company = $7, job_title = $8,
       department = $9, emails = $10, phones = $11, addresses = $12, websites = $13, birthday = $14, notes = $15,
       display = $16, sort_key = $17, search = $18, modified_at = now()
     WHERE id = $1::uuid AND owner = $2 AND held_deleted_at IS NULL RETURNING id`,
    [id, owner, ...fields(c)],
  );
  if (!rows.length) throw new UserError("Contact not found", 404);
  return get(owner, id);
}

/**
 * Deletes contacts for good, unless their owner is on legal hold: then they are only hidden,
 * still found by eDiscovery. Once the hold is lifted, the owner's next delete clears them too.
 */
export async function remove(owner: string, ids: string[]): Promise<number> {
  if (await policy().onHold(owner)) {
    const kept = await q(
      `UPDATE contacts SET held_deleted_at = now() WHERE owner = $1 AND id = ANY($2::uuid[]) AND held_deleted_at IS NULL RETURNING id`,
      [owner, ids],
    );
    return kept.length;
  }
  const rows = await q(`DELETE FROM contacts WHERE owner = $1 AND id = ANY($2::uuid[]) AND held_deleted_at IS NULL RETURNING id`, [owner, ids]);
  await q(`DELETE FROM contacts WHERE owner = $1 AND held_deleted_at IS NOT NULL`, [owner]);
  return rows.length;
}

export async function setFavorite(owner: string, id: string, favorite: boolean): Promise<void> {
  const rows = await q(`UPDATE contacts SET favorite = $3 WHERE id = $1::uuid AND owner = $2 AND held_deleted_at IS NULL RETURNING id`, [id, owner, favorite]);
  if (!rows.length) throw new UserError("Contact not found", 404);
}

/** Only real images are kept, checked by their first bytes rather than what the browser claims. */
export function sniffImage(data: Buffer): string | null {
  if (data.length > PHOTO_MAX) throw new UserError("Pick a photo under 2 MB");
  if (data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff) return "image/jpeg";
  if (data.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "image/png";
  if (data.subarray(0, 4).toString("latin1") === "GIF8") return "image/gif";
  if (data.subarray(0, 4).toString("latin1") === "RIFF" && data.subarray(8, 12).toString("latin1") === "WEBP") return "image/webp";
  return null;
}

export async function setPhoto(owner: string, id: string, data: Buffer | null): Promise<void> {
  let mime: string | null = null;
  if (data) {
    mime = sniffImage(data);
    if (!mime) throw new UserError("Pick a JPEG, PNG, GIF or WebP image");
  }
  const rows = await q(`UPDATE contacts SET photo = $3, photo_mime = $4, modified_at = now() WHERE id = $1::uuid AND owner = $2 AND held_deleted_at IS NULL RETURNING id`, [id, owner, data, mime]);
  if (!rows.length) throw new UserError("Contact not found", 404);
}

export async function photo(owner: string, id: string): Promise<{ mime: string; data: Buffer } | null> {
  const [row] = await q<{ photo: Buffer | null; photo_mime: string | null }>(`SELECT photo, photo_mime FROM contacts WHERE id = $1::uuid AND owner = $2 AND held_deleted_at IS NULL`, [id, owner]);
  return row?.photo ? { mime: row.photo_mime || "image/jpeg", data: row.photo } : null;
}

// Groups

export async function groups(owner: string): Promise<Group[]> {
  return q<Group>(
    `SELECT g.id, g.name, (SELECT count(*)::int FROM group_members gm JOIN contacts c ON c.id = gm.contact_id AND c.held_deleted_at IS NULL WHERE gm.group_id = g.id) AS count
     FROM groups g WHERE g.owner = $1 ORDER BY lower(g.name)`,
    [owner],
  );
}

function groupName(v: unknown): string {
  const name = text(v, 100);
  if (!name) throw new UserError("Give the group a name");
  return name;
}

export async function createGroup(owner: string, name: string): Promise<Group> {
  const [g] = await q<Group>(`INSERT INTO groups (owner, name) VALUES ($1, $2) RETURNING id, name, 0 AS count`, [owner, groupName(name)]).catch((e) => {
    if (e?.code === "23505") throw new UserError("You already have a group with that name", 409);
    throw e;
  });
  return g;
}

export async function renameGroup(owner: string, id: string, name: string): Promise<void> {
  const rows = await q(`UPDATE groups SET name = $3 WHERE id = $1::uuid AND owner = $2 RETURNING id`, [id, owner, groupName(name)]).catch((e) => {
    if (e?.code === "23505") throw new UserError("You already have a group with that name", 409);
    throw e;
  });
  if (!rows.length) throw new UserError("Group not found", 404);
}

export async function deleteGroup(owner: string, id: string): Promise<void> {
  const rows = await q(`DELETE FROM groups WHERE id = $1::uuid AND owner = $2 RETURNING id`, [id, owner]);
  if (!rows.length) throw new UserError("Group not found", 404);
}

type Tq = <R = Record<string, unknown>>(text: string, params?: unknown[]) => Promise<R[]>;

async function addToGroups(tq: Tq, owner: string, contactIds: string[], groupIds: string[]): Promise<void> {
  if (!groupIds.length || !contactIds.length) return;
  // The owner check on both sides stops anyone adding to another person's group or contact.
  await tq(
    `INSERT INTO group_members (group_id, contact_id)
     SELECT g.id, c.id FROM groups g, contacts c
     WHERE g.owner = $1 AND c.owner = $1 AND c.held_deleted_at IS NULL AND g.id = ANY($2::uuid[]) AND c.id = ANY($3::uuid[])
     ON CONFLICT DO NOTHING`,
    [owner, groupIds, contactIds],
  );
}

export async function setMembership(owner: string, groupId: string, contactIds: string[], member: boolean): Promise<void> {
  const [g] = await q(`SELECT 1 FROM groups WHERE id = $1::uuid AND owner = $2`, [groupId, owner]);
  if (!g) throw new UserError("Group not found", 404);
  if (member) await tx((tq) => addToGroups(tq, owner, contactIds, [groupId]));
  else await q(`DELETE FROM group_members WHERE group_id = $1::uuid AND contact_id = ANY($2::uuid[])`, [groupId, contactIds]);
}

// Import and export

export async function importContacts(owner: string, parsed: ParsedContact[]): Promise<{ added: number; skipped: number; failed: number }> {
  if (parsed.length > 10000) throw new UserError("Import up to 10,000 contacts at a time");
  const existing = new Set(
    (await q<{ e: string }>(`SELECT lower(e->>'value') AS e FROM contacts, jsonb_array_elements(emails) e WHERE owner = $1 AND held_deleted_at IS NULL`, [owner])).map((r) => r.e),
  );
  let added = 0;
  let skipped = 0;
  let failed = 0;
  await tx(async (tq) => {
    const groupIds = new Map<string, string>();
    for (const g of await tq<{ id: string; name: string }>(`SELECT id, name FROM groups WHERE owner = $1`, [owner])) groupIds.set(g.name.toLowerCase(), g.id);
    for (const p of parsed) {
      let c: ContactInput;
      try {
        c = clean({ ...p, emails: p.emails.filter((e) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e.value)), websites: p.websites.filter((w) => !/^(?!https?:)[a-z][a-z0-9+.-]*:/i.test(w.value)) });
      } catch {
        failed++;
        continue;
      }
      // Someone already in the address book, matched by email, is left as it is.
      if (c.emails.some((e) => existing.has(e.value.toLowerCase()))) {
        skipped++;
        continue;
      }
      const [row] = await tq<{ id: string }>(
        `INSERT INTO contacts (owner, first_name, middle_name, last_name, nickname, company, job_title, department,
           emails, phones, addresses, websites, birthday, notes, display, sort_key, search, photo, photo_mime)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19) RETURNING id`,
        [owner, ...fields(c), ...photoFields(p.photo)],
      );
      for (const e of c.emails) existing.add(e.value.toLowerCase());
      const ids: string[] = [];
      for (const name of new Set(p.groups.map((g) => text(g, 100)).filter(Boolean))) {
        let id = groupIds.get(name.toLowerCase());
        if (!id) {
          [{ id }] = await tq<{ id: string }>(`INSERT INTO groups (owner, name) VALUES ($1, $2) RETURNING id`, [owner, name]);
          groupIds.set(name.toLowerCase(), id);
        }
        ids.push(id);
      }
      await addToGroups(tq, owner, [row.id], ids);
      added++;
    }
  });
  return { added, skipped, failed };
}

function photoFields(p: ParsedContact["photo"]): [Buffer | null, string | null] {
  if (!p) return [null, null];
  try {
    const mime = sniffImage(p.data);
    return mime ? [p.data, mime] : [null, null];
  } catch {
    return [null, null]; // too big: the contact still comes in, without the photo
  }
}

export async function exportCards(owner: string, ids?: string[]): Promise<CardOut[]> {
  const rows = await q<Row & { photo: Buffer | null; photo_mime: string | null; group_names: string[] | null }>(
    `SELECT ${COLS}, c.photo, c.photo_mime,
       (SELECT array_agg(g.name ORDER BY lower(g.name)) FROM group_members gm JOIN groups g ON g.id = gm.group_id WHERE gm.contact_id = c.id) AS group_names
     FROM contacts c WHERE c.owner = $1 AND c.held_deleted_at IS NULL ${ids ? "AND c.id = ANY($2::uuid[])" : ""} ORDER BY c.sort_key`,
    ids ? [owner, ids] : [owner],
  );
  return rows.map((r) => ({
    ...toContact(r), groups: r.group_names ?? [], uid: r.id,
    photo: r.photo ? { mime: r.photo_mime || "image/jpeg", data: r.photo } : null,
  }));
}
