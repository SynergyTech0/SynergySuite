// CardDAV for phones and desktop address books: each person has one address book, "Contacts",
// holding the same contacts the web app shows them (read and write). Sign-in is Basic with an
// app password from the Account page. The organization directory isn't offered here.
import { appPasswordVerifier, createDavHandler, DavError, type DavBackend, type ObjectMeta } from "@synergy/dav";
import { clean, exportCards, remove as removeContacts, sniffImage } from "./contacts";
import { q, tx } from "./db";
import { displayName, type ContactInput } from "./types";
import { UserError, text } from "./util";
import { parseVCards, toVCard } from "./vcard";

const BOOK = "contacts";
const VALID = "{urn:ietf:params:xml:ns:carddav}valid-address-data";
const NO_UID_CONFLICT = "{urn:ietf:params:xml:ns:carddav}no-uid-conflict";

type MetaRow = { id: string; dav_name: string; modseq: string; modified_at: Date };
const meta = (r: MetaRow): ObjectMeta => ({ name: r.dav_name, etag: `"${r.modseq}"`, lastModified: new Date(r.modified_at) });

function book(id: string) {
  if (id !== BOOK) throw new DavError(404, "No such address book");
}

async function token(owner: string): Promise<string> {
  const [r] = await q<{ t: string }>(
    `SELECT GREATEST(
       (SELECT COALESCE(max(modseq), 0) FROM contacts WHERE owner = $1),
       (SELECT COALESCE(max(modseq), 0) FROM contact_tombstones WHERE owner = $1)) AS t`,
    [owner],
  );
  return String(r.t);
}

async function byName(owner: string, names: string[]): Promise<MetaRow[]> {
  return q<MetaRow>(
    `SELECT id, dav_name, modseq, modified_at FROM contacts WHERE owner = $1 AND held_deleted_at IS NULL AND dav_name = ANY($2::text[])`,
    [owner, names],
  );
}

function sortKey(c: ContactInput, display: string): string {
  return (c.lastName ? `${c.lastName} ${c.firstName}` : display).toLowerCase();
}
function searchText(c: ContactInput, display: string): string {
  return [display, c.nickname, c.company, c.jobTitle, c.department, ...c.emails.map((e) => e.value), ...c.phones.map((p) => p.value.replace(/\D/g, "")),
    ...c.addresses.map((a) => `${a.city} ${a.country}`)].join(" ").toLowerCase();
}

/** Reads the one card a phone sent and checks it the way an import does. */
function parseCard(data: string) {
  const cards = parseVCards(data);
  if (cards.length !== 1) throw new DavError(415, "Send exactly one vCard", VALID);
  const p = cards[0];
  let c: ContactInput;
  try {
    c = clean({
      ...p,
      emails: p.emails.filter((e) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e.value)),
      websites: p.websites.filter((w) => !/^(?!https?:)[a-z][a-z0-9+.-]*:/i.test(w.value)),
    });
  } catch (e) {
    if (e instanceof UserError) throw new DavError(403, e.message, VALID);
    throw e;
  }
  let photo: { data: Buffer; mime: string } | null = null;
  if (p.photo) {
    try {
      const mime = sniffImage(p.photo.data);
      if (mime) photo = { data: p.photo.data, mime };
    } catch {
      photo = null; // over 2 MB: the card is kept without it
    }
  }
  return {
    contact: c, photo, uid: p.uid, extra: p.extra ?? "",
    // A card without CATEGORIES leaves group membership as it is: not every phone keeps them.
    groups: /^(item\d+\.)?CATEGORIES[;:]/im.test(data) ? [...new Set(p.groups.map((g) => text(g, 100)).filter(Boolean))] : null,
  };
}

export const backend: DavBackend = {
  async collections(owner) {
    return [{ id: BOOK, displayName: "Contacts", description: "Your contacts in Synergy Contacts", readOnly: false, syncToken: await token(owner) }];
  },

  async list(owner, id) {
    book(id);
    const rows = await q<MetaRow>(
      `SELECT id, dav_name, modseq, modified_at FROM contacts WHERE owner = $1 AND held_deleted_at IS NULL ORDER BY sort_key, id`, [owner]);
    return rows.map(meta);
  },

  async get(owner, id, names) {
    book(id);
    if (!names.length) return [];
    const rows = await q<MetaRow & { uid: string; vcard_extra: string }>(
      `SELECT id, dav_name, modseq, modified_at, uid, vcard_extra FROM contacts
        WHERE owner = $1 AND held_deleted_at IS NULL AND dav_name = ANY($2::text[])`,
      [owner, names],
    );
    if (!rows.length) return [];
    const cards = new Map((await exportCards(owner, rows.map((r) => r.id))).map((c) => [c.uid, c]));
    return rows.flatMap((r) => {
      const card = cards.get(r.id);
      return card ? [{ ...meta(r), data: toVCard({ ...card, uid: r.uid, extra: r.vcard_extra }) }] : [];
    });
  },

  async put(owner, id, name, data, existing) {
    book(id);
    const card = parseCard(data);
    const c = card.contact;
    const display = displayName(c);
    const values = [c.firstName, c.middleName, c.lastName, c.nickname, c.company, c.jobTitle, c.department,
      JSON.stringify(c.emails), JSON.stringify(c.phones), JSON.stringify(c.addresses), JSON.stringify(c.websites),
      c.birthday || null, c.notes, display, sortKey(c, display), searchText(c, display),
      card.extra, card.photo?.data ?? null, card.photo?.mime ?? null];
    const contactId = await tx(async (tq) => {
      let cid: string;
      if (existing) {
        const [row] = await tq<{ id: string; uid: string }>(
          `SELECT id, uid FROM contacts WHERE owner = $1 AND dav_name = $2 AND held_deleted_at IS NULL FOR UPDATE`, [owner, name]);
        if (!row) throw new DavError(404, "Not found");
        if (card.uid && card.uid !== row.uid) throw new DavError(409, "The UID of a card can't change", NO_UID_CONFLICT);
        await tq(
          `UPDATE contacts SET first_name = $2, middle_name = $3, last_name = $4, nickname = $5, company = $6, job_title = $7,
             department = $8, emails = $9, phones = $10, addresses = $11, websites = $12, birthday = $13, notes = $14,
             display = $15, sort_key = $16, search = $17, vcard_extra = $18, photo = $19, photo_mime = $20, modified_at = now()
           WHERE id = $1`,
          [row.id, ...values],
        );
        cid = row.id;
      } else {
        const uid = card.uid || name.replace(/\.vcf$/i, "");
        const [clash] = await tq(`SELECT 1 FROM contacts WHERE owner = $1 AND uid = $2 AND held_deleted_at IS NULL`, [owner, uid]);
        if (clash) throw new DavError(409, "A card with this UID is already stored", NO_UID_CONFLICT);
        const [row] = await tq<{ id: string }>(
          `INSERT INTO contacts (owner, first_name, middle_name, last_name, nickname, company, job_title, department,
             emails, phones, addresses, websites, birthday, notes, display, sort_key, search, vcard_extra, photo, photo_mime, uid, dav_name)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22) RETURNING id`,
          [owner, ...values, uid, name],
        );
        cid = row.id;
      }
      if (card.groups) {
        const ids: string[] = [];
        for (const g of card.groups) {
          const [found] = await tq<{ id: string }>(`SELECT id FROM groups WHERE owner = $1 AND lower(name) = lower($2)`, [owner, g]);
          ids.push(found?.id ?? (await tq<{ id: string }>(`INSERT INTO groups (owner, name) VALUES ($1, $2) RETURNING id`, [owner, g]))[0].id);
        }
        await tq(`DELETE FROM group_members WHERE contact_id = $1 AND NOT (group_id = ANY($2::uuid[]))`, [cid, ids]);
        if (ids.length) {
          await tq(`INSERT INTO group_members (group_id, contact_id) SELECT unnest($2::uuid[]), $1 ON CONFLICT DO NOTHING`, [cid, ids]);
        }
      }
      return cid;
    });
    const [after] = await q<MetaRow>(`SELECT id, dav_name, modseq, modified_at FROM contacts WHERE id = $1`, [contactId]);
    return meta(after);
  },

  async remove(owner, id, name) {
    book(id);
    const [row] = await byName(owner, [name]);
    if (!row) throw new DavError(404, "Not found");
    await removeContacts(owner, [row.id]);
  },

  async changes(owner, id, since) {
    book(id);
    const s = Number(since);
    const [seq] = await q<{ last_value: string; is_called: boolean }>(`SELECT last_value, is_called FROM contact_modseq`);
    if (!Number.isSafeInteger(s) || s > (seq.is_called ? Number(seq.last_value) : 0)) return null;
    const changed = await q<MetaRow>(
      `SELECT id, dav_name, modseq, modified_at FROM contacts WHERE owner = $1 AND held_deleted_at IS NULL AND modseq > $2 ORDER BY modseq`,
      [owner, s],
    );
    const removed = await q<{ dav_name: string }>(
      `SELECT DISTINCT t.dav_name FROM contact_tombstones t
        WHERE t.owner = $1 AND t.modseq > $2
          AND NOT EXISTS (SELECT 1 FROM contacts c WHERE c.owner = $1 AND c.held_deleted_at IS NULL AND c.dav_name = t.dav_name)`,
      [owner, s],
    );
    return { token: String(Math.max(s, Number(await token(owner)))), changed: changed.map(meta), removed: removed.map((r) => r.dav_name) };
  },
};

type Handler = ReturnType<typeof createDavHandler>;
const g = globalThis as unknown as { __contactsDav?: Handler };

/** The CardDAV handler; `authenticate` is for tests (the default asks the auth service). */
export function carddav(authenticate?: (user: string, password: string, ip: string) => Promise<string | null>): Handler {
  if (authenticate) return createDavHandler({ kind: "addressbook", backend, realm: "Synergy Contacts", authenticate });
  if (!g.__contactsDav) {
    g.__contactsDav = createDavHandler({ kind: "addressbook", backend, realm: "Synergy Contacts", authenticate: appPasswordVerifier({ app: "contacts" }) });
  }
  return g.__contactsDav;
}
