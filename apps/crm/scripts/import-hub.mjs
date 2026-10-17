/*
 * Brings the CRM side of the older SynergyRoutes app into the CRM. Reads the export
 * (deploy/hub-import/routes.sql) on stdin, one JSON object per line; deploy/hub-import/run.sh
 * does both steps.
 *
 *   - Accounts keep their SynergyRoutes ids, so running it again updates what is already here
 *     instead of adding it twice. The entity type (Pharmacy, Hospice, Hospital, ...) becomes the
 *     account's industry; street, city, state, ZIP and position come across as they were. Visit
 *     priority and frequency, the last visit, the next action date and every registry fact in
 *     `custom` (ratings, certified beds, ownership, license, ...) go to the account's details,
 *     one readable line each.
 *   - Contacts (mostly each business's main phone line) keep their ids too, are owned by their
 *     account's owner, and give an account with no phone its first contact's number.
 *   - Opportunities and activities come across with their stage, amounts, dates and status.
 *     An activity's place, meeting link and length are added to its notes.
 *   - Owners and assignees are matched by email; --map-email old@example.com=new@example.com
 *     makes someone who signs in here with another address the owner. Anyone not yet in the
 *     CRM is added as a rep (their first visit keeps that row). Records with no owner, or one
 *     with no email, go to --owner <email> (a CRM member), or else the longest-standing admin.
 *   - Territories, routes and route stops are route planning and stay behind.
 *
 * Rows are written 1000 at a time, each batch in its own transaction, so 160,000 accounts take
 * a minute or two and an interrupted run can simply be started again. A re-run brings the old
 * app's values back over changes made here to the same fields, except an account's type,
 * website and phone, which are kept once set here. --dry-run does the whole import in one
 * transaction and rolls it back, so its counts are exact and nothing is written. --batch <n>
 * changes how many rows go per transaction.
 */
import readline from 'node:readline';
import { createDb } from '@synergy/db';

const argv = process.argv.slice(2);
const DRY = argv.includes('--dry-run');
const flag = (name) => {
  const i = argv.indexOf(name);
  if (i >= 0) return argv[i + 1];
  return argv.find((a) => a.startsWith(`${name}=`))?.slice(name.length + 1);
};
/** --map-email old@x=new@y (repeatable): someone who signs in to the suite with another address. */
const MAP = new Map(argv.flatMap((a, i) => (a === '--map-email' ? [argv[i + 1]] : a.startsWith('--map-email=') ? [a.slice(12)] : []))
  .map((v) => String(v ?? '').toLowerCase().split('=').map((x) => x.trim())).filter(([a, b]) => a && b));
const BATCH = Math.max(1, Number(flag('--batch')) || 1000);
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const text = (v, max = 500) => String(v ?? '').replace(/\u0000/g, '').trim().slice(0, max);
const email = (v) => {
  const e = String(v ?? '').trim().toLowerCase();
  return MAP.get(e) ?? e;
};
const num = (v) => (v === null || v === undefined || v === '' || !Number.isFinite(Number(v)) ? null : Number(v));
const day = (v) => (v ? String(v).slice(0, 10) : '');

const ACCOUNT_TYPES = ['prospect', 'customer', 'partner', 'competitor', 'other'];
const STAGES = {
  prospecting: 'prospecting', prospect: 'prospecting', lead: 'prospecting', new: 'prospecting', discovery: 'prospecting',
  qualification: 'qualification', qualified: 'qualification', qualify: 'qualification', needs_analysis: 'qualification',
  proposal: 'proposal', quote: 'proposal', quoted: 'proposal', demo: 'proposal',
  negotiation: 'negotiation', negotiating: 'negotiation', contract: 'negotiation', commit: 'negotiation',
  closed_won: 'closed_won', won: 'closed_won', win: 'closed_won', closed: 'closed_won',
  closed_lost: 'closed_lost', lost: 'closed_lost', loss: 'closed_lost',
};
const ACTIVITY_TYPES = {
  task: 'task', todo: 'task', follow_up: 'task', followup: 'task',
  call: 'call', phone: 'call', phone_call: 'call',
  meeting: 'event', event: 'event', visit: 'event', appointment: 'event', demo: 'event',
};
const STATUSES = {
  completed: 'completed', complete: 'completed', done: 'completed', closed: 'completed',
  canceled: 'canceled', cancelled: 'canceled', skipped: 'canceled',
};
const key = (v) => String(v ?? '').trim().toLowerCase().replace(/[\s-]+/g, '_');

/** A registry value as one readable line: lists joined, yes/no for flags, JSON for anything else. */
function readable(v) {
  if (v === null || v === undefined) return '';
  if (typeof v === 'boolean') return v ? 'Yes' : 'No';
  if (Array.isArray(v)) return v.map(readable).filter(Boolean).join(', ');
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v).trim();
}

/** An account's details: what has no field of its own here, by label. */
function details(a) {
  const out = {};
  const put = (k, v) => {
    const s = readable(v);
    if (k && s) out[text(k, 120)] = s.slice(0, 2000);
  };
  for (const [k, v] of Object.entries(a.custom && typeof a.custom === 'object' && !Array.isArray(a.custom) ? a.custom : {})) put(k, v);
  if (a.priority !== null && a.priority !== undefined) put('Priority', a.priority);
  if (num(a.visit_frequency_days)) put('Visit every', `${num(a.visit_frequency_days)} days`);
  put('Last visited', day(a.last_visited_at));
  put('Next action', day(a.next_action_at));
  if (a.crm_source || a.crm_external_id) put('Synced from', [a.crm_source, a.crm_external_id].filter(Boolean).join(' '));
  return out;
}

/** Lines from stdin as objects. A whole-document export ({accounts: [...], ...}) works too. */
async function* records(input) {
  const rl = readline.createInterface({ input, crlfDelay: Infinity });
  const kinds = { users: 'user', accounts: 'account', contacts: 'contact', opportunities: 'opportunity', activities: 'activity' };
  for await (const raw of rl) {
    const line = raw.trim();
    if (!line) continue;
    if (line === '#hub-files') break;
    const obj = JSON.parse(line);
    if (obj && obj.kind) { yield obj; continue; }
    // One JSON document, the way the other parts export.
    if (obj && typeof obj === 'object') {
      for (const [list, kind] of Object.entries(kinds)) for (const r of obj[list] ?? []) yield { ...r, kind };
    }
  }
}

async function main() {
  const database = createDb({ connectionString: process.env.CRM_DATABASE_URL || undefined, max: 1 });
  const client = await database.pool.connect();
  const db = async (q, params = []) => (await client.query(q, params)).rows;
  const log = (s) => console.log((DRY ? '[dry run] ' : '') + s);
  const started = Date.now();

  try {
    const [{ ok }] = await db(`SELECT EXISTS (SELECT 1 FROM information_schema.columns
      WHERE table_schema = current_schema() AND table_name = 'accounts' AND column_name = 'details') AS ok`);
    if (!ok) throw new Error('The CRM has not set up its database for this yet. Open the CRM once (after updating the crm image) and run this again.');

    const fallback = flag('--owner') ? email(flag('--owner')) : null;
    let defaultOwner;
    if (fallback) {
      if (!(await db('SELECT 1 FROM members WHERE email = $1', [fallback])).length)
        throw new Error(`${fallback} hasn't opened the CRM yet, so it can't own records. Open the CRM as them first, or pick someone else with --owner.`);
      defaultOwner = fallback;
    } else {
      [{ email: defaultOwner } = {}] = await db(`SELECT email FROM members WHERE role = 'admin' ORDER BY created_at LIMIT 1`);
      // The first person into the CRM becomes its admin; importing reps into an empty CRM would leave it without one.
      if (!defaultOwner) throw new Error('Nobody has opened the CRM yet. Open it once (the first person in becomes its admin), then run this again.');
    }

    if (DRY) await db('BEGIN');
    /** One batch, in its own transaction (or inside the dry run's). */
    const batch = async (fn) => {
      if (DRY) return fn();
      await db('BEGIN');
      try {
        const out = await fn();
        await db('COMMIT');
        return out;
      } catch (e) {
        await db('ROLLBACK').catch(() => {});
        throw e;
      }
    };

    const users = new Map(); // old user id -> email here
    const members = new Set((await db('SELECT email FROM members')).map((r) => r.email));
    const people = { matched: new Set(), added: new Set(), unknown: 0 };
    let header = null;
    /** The CRM member who owns what the old user owned, adding them as a rep when they aren't one yet. */
    const pending = new Set();
    const ownerOf = (oldId) => {
      const e = oldId ? users.get(String(oldId)) : null;
      if (!e) {
        if (oldId) people.unknown++;
        return defaultOwner;
      }
      if (members.has(e)) { if (!people.added.has(e)) people.matched.add(e); }
      else pending.add(e);
      return e;
    };
    const addPending = async () => {
      if (!pending.size) return;
      const list = [...pending];
      await db(`INSERT INTO members (email, name, role) SELECT e, '', 'rep' FROM unnest($1::text[]) e ON CONFLICT (email) DO NOTHING`, [list]);
      for (const e of list) { members.add(e); people.added.add(e); }
      pending.clear();
    };

    const counts = {};
    const tally = (kind, rows) => {
      const c = (counts[kind] ??= { added: 0, updated: 0, unchanged: 0, skipped: 0 });
      for (const r of rows) c[r.inserted ? 'added' : 'updated']++;
      return c;
    };
    let progress = 0;
    const tick = (n) => {
      const before = Math.floor(progress / 20000);
      progress += n;
      if (Math.floor(progress / 20000) > before) log(`… ${progress.toLocaleString('en-US')} rows`);
    };

    /** How many of these account ids (one per row) have no account here. */
    const orphans = async (ids) => (await db(
      `SELECT count(*)::int AS n FROM unnest($1::uuid[]) AS x(id) WHERE x.id IS NULL OR NOT EXISTS (SELECT 1 FROM accounts a WHERE a.id = x.id)`,
      [ids.map((v) => v ?? null)],
    ))[0].n;

    const flushAccounts = async (rows) => {
      const out = rows.map((a) => ({
        id: a.id,
        name: text(String(a.name ?? '').replace(/\s+/g, ' '), 200) || '(no name)',
        industry: text(a.entity_type, 120),
        address: [text(a.address_line1, 250), text(a.address_line2, 250)].filter(Boolean).join('\n'),
        city: text(a.city, 120),
        state: text(a.state, 60),
        postal_code: text(a.zip, 20),
        lat: num(a.lat),
        lng: num(a.lng),
        type: ACCOUNT_TYPES.includes(key(a.type)) ? key(a.type) : 'prospect',
        details: details(a),
        owner: ownerOf(a.owner_id),
        created_at: a.created_at ?? null,
        updated_at: a.updated_at ?? a.created_at ?? null,
      }));
      const res = await batch(async () => {
        await addPending();
        return db(
          `INSERT INTO accounts AS t (id, name, industry, address, city, state, postal_code, lat, lng, type, details, owner, created_at, updated_at)
           SELECT r.id, r.name, r.industry, r.address, r.city, r.state, r.postal_code, r.lat, r.lng, r.type, coalesce(r.details, '{}'),
                  r.owner, coalesce(r.created_at, now()), coalesce(r.updated_at, now())
           FROM json_to_recordset($1::json) AS r(id uuid, name text, industry text, address text, city text, state text,
                postal_code text, lat float8, lng float8, type text, details jsonb, owner text, created_at timestamptz, updated_at timestamptz)
           ON CONFLICT (id) DO UPDATE SET name = excluded.name, industry = excluded.industry, address = excluded.address,
                city = excluded.city, state = excluded.state, postal_code = excluded.postal_code, lat = excluded.lat, lng = excluded.lng,
                details = excluded.details, owner = excluded.owner, updated_at = greatest(t.updated_at, excluded.updated_at)
           WHERE (t.name, t.industry, t.address, t.city, t.state, t.postal_code, t.lat, t.lng, t.details, t.owner)
                 IS DISTINCT FROM (excluded.name, excluded.industry, excluded.address, excluded.city, excluded.state,
                 excluded.postal_code, excluded.lat, excluded.lng, excluded.details, excluded.owner)
           RETURNING (xmax = 0) AS inserted`,
          [JSON.stringify(out)],
        );
      });
      tally('accounts', res).unchanged += rows.length - res.length;
    };

    const flushContacts = async (rows) => {
      const out = rows.map((c) => ({
        id: c.id,
        account_id: c.account_id,
        name: text(c.name, 200) || 'Main line',
        email: EMAIL.test(text(c.email, 254)) ? text(c.email, 254).toLowerCase() : '',
        phone: text(c.phone, 40),
        title: text(c.title, 120),
        created_at: c.created_at ?? null,
      }));
      const [res, phones] = await batch(async () => {
        const res = await db(
          `INSERT INTO contacts AS t (id, account_id, name, email, phone, title, owner, created_at, updated_at)
           SELECT r.id, r.account_id, r.name, r.email, r.phone, r.title, a.owner, coalesce(r.created_at, now()), coalesce(r.created_at, now())
           FROM json_to_recordset($1::json) AS r(id uuid, account_id uuid, name text, email text, phone text, title text, created_at timestamptz)
           JOIN accounts a ON a.id = r.account_id
           ON CONFLICT (id) DO UPDATE SET account_id = excluded.account_id, name = excluded.name, email = excluded.email,
                phone = excluded.phone, title = excluded.title, owner = excluded.owner
           WHERE (t.account_id, t.name, t.email, t.phone, t.title, t.owner)
                 IS DISTINCT FROM (excluded.account_id, excluded.name, excluded.email, excluded.phone, excluded.title, excluded.owner)
           RETURNING (xmax = 0) AS inserted`,
          [JSON.stringify(out)],
        );
        // The main line is the account's phone too, until someone gives it one here.
        const phones = await db(
          `UPDATE accounts a SET phone = p.phone
           FROM (SELECT DISTINCT ON (r.account_id) r.account_id, r.phone FROM json_to_recordset($1::json) AS r(account_id uuid, phone text)
                 WHERE r.phone <> '' ORDER BY r.account_id) p
           WHERE a.id = p.account_id AND a.phone = '' RETURNING a.id`,
          [JSON.stringify(out)],
        );
        return [res, phones.length];
      });
      // Rows whose account didn't come across are skipped; the rest that returned nothing were already up to date.
      const missing = await orphans(out.map((r) => r.account_id));
      const c = tally('contacts', res);
      c.unchanged += rows.length - res.length - missing;
      c.skipped += missing;
      counts.phones = (counts.phones ?? 0) + phones;
    };

    const flushOpportunities = async (rows) => {
      const out = rows.map((o) => {
        let p = num(o.probability);
        if (p !== null && p > 0 && p < 1) p *= 100;
        const amount = num(o.amount);
        return {
          id: o.id,
          account_id: o.account_id,
          name: text(o.name, 200) || 'Opportunity',
          amount: amount === null ? null : amount.toFixed(2),
          stage: STAGES[key(o.stage)] ?? 'prospecting',
          close_date: o.close_date ? day(o.close_date) : null,
          probability: p === null ? null : Math.min(100, Math.max(0, Math.round(p))),
          owner: ownerOf(o.owner_id),
          created_at: o.created_at ?? null,
          updated_at: o.updated_at ?? o.created_at ?? null,
        };
      });
      const res = await batch(async () => {
        await addPending();
        return db(
          `INSERT INTO opportunities AS t (id, account_id, name, amount, stage, close_date, probability, owner, created_at, updated_at)
           SELECT r.id, r.account_id, r.name, r.amount, r.stage, r.close_date, r.probability, r.owner,
                  coalesce(r.created_at, now()), coalesce(r.updated_at, now())
           FROM json_to_recordset($1::json) AS r(id uuid, account_id uuid, name text, amount numeric, stage text, close_date date,
                probability int, owner text, created_at timestamptz, updated_at timestamptz)
           WHERE EXISTS (SELECT 1 FROM accounts a WHERE a.id = r.account_id)
           ON CONFLICT (id) DO UPDATE SET account_id = excluded.account_id, name = excluded.name, amount = excluded.amount,
                stage = excluded.stage, close_date = excluded.close_date, probability = excluded.probability, owner = excluded.owner,
                updated_at = greatest(t.updated_at, excluded.updated_at)
           WHERE (t.account_id, t.name, t.amount, t.stage, t.close_date, t.probability, t.owner)
                 IS DISTINCT FROM (excluded.account_id, excluded.name, excluded.amount, excluded.stage, excluded.close_date,
                 excluded.probability, excluded.owner)
           RETURNING (xmax = 0) AS inserted`,
          [JSON.stringify(out)],
        );
      });
      const missing = await orphans(out.map((r) => r.account_id));
      const c = tally('opportunities', res);
      c.unchanged += rows.length - res.length - missing;
      c.skipped += missing;
    };

    const flushActivities = async (rows) => {
      const out = rows.map((t) => {
        const extra = [
          t.location ? `Where: ${text(t.location, 500)}` : '',
          t.meeting_url ? `Meeting link: ${text(t.meeting_url, 500)}` : '',
          num(t.duration_min) ? `Length: ${num(t.duration_min)} minutes` : '',
        ].filter(Boolean);
        const body = [text(t.body, 20000), extra.join('\n')].filter(Boolean).join('\n\n');
        const due = t.scheduled_at || (t.due_date ? `${day(t.due_date)}T12:00:00Z` : null);
        const [related_type, related_id] = t.opportunity_id ? ['opportunity', t.opportunity_id]
          : t.contact_id ? ['contact', t.contact_id] : ['account', t.account_id];
        return {
          id: t.id,
          type: ACTIVITY_TYPES[key(t.type)] ?? 'note',
          subject: text(t.subject, 300) || text(t.type, 60) || 'Activity',
          body,
          due_at: due,
          status: STATUSES[key(t.status)] ?? 'open',
          assignee: ownerOf(t.assignee_id),
          related_type, related_id,
          account_id: t.account_id,
          created_at: t.created_at ?? null,
          updated_at: t.updated_at ?? t.created_at ?? null,
        };
      });
      const res = await batch(async () => {
        await addPending();
        // A contact or deal that didn't come across: the activity goes on the account instead.
        return db(
          `INSERT INTO activities AS t (id, type, subject, body, due_at, status, assignee, related_type, related_id, created_at, updated_at)
           SELECT r.id, r.type, r.subject, r.body, r.due_at, r.status, r.assignee, x.related_type, x.related_id,
                  coalesce(r.created_at, now()), coalesce(r.updated_at, now())
           FROM json_to_recordset($1::json) AS r(id uuid, type text, subject text, body text, due_at timestamptz, status text,
                assignee text, related_type text, related_id uuid, account_id uuid, created_at timestamptz, updated_at timestamptz)
           CROSS JOIN LATERAL (SELECT * FROM (VALUES
                 (1, r.related_type, r.related_id, CASE r.related_type
                   WHEN 'opportunity' THEN EXISTS (SELECT 1 FROM opportunities o WHERE o.id = r.related_id)
                   WHEN 'contact' THEN EXISTS (SELECT 1 FROM contacts c WHERE c.id = r.related_id)
                   ELSE EXISTS (SELECT 1 FROM accounts a WHERE a.id = r.related_id) END),
                 (2, 'account', r.account_id, EXISTS (SELECT 1 FROM accounts a WHERE a.id = r.account_id))
               ) v(n, related_type, related_id, ok) WHERE v.ok ORDER BY v.n LIMIT 1) x
           ON CONFLICT (id) DO UPDATE SET type = excluded.type, subject = excluded.subject, body = excluded.body,
                due_at = excluded.due_at, status = excluded.status, assignee = excluded.assignee,
                related_type = excluded.related_type, related_id = excluded.related_id,
                updated_at = greatest(t.updated_at, excluded.updated_at)
           WHERE (t.type, t.subject, t.body, t.due_at, t.status, t.assignee, t.related_type, t.related_id)
                 IS DISTINCT FROM (excluded.type, excluded.subject, excluded.body, excluded.due_at, excluded.status,
                 excluded.assignee, excluded.related_type, excluded.related_id)
           RETURNING (xmax = 0) AS inserted`,
          [JSON.stringify(out)],
        );
      });
      tally('activities', res).unchanged += rows.length - res.length;
    };

    // Parents before children: the export comes in that order, and each kind's last rows are
    // written before the next kind starts.
    const FLUSH = { account: flushAccounts, contact: flushContacts, opportunity: flushOpportunities, activity: flushActivities };
    const ORDER = ['user', 'account', 'contact', 'opportunity', 'activity'];
    let current = null;
    let rows = [];
    let seen = 0;
    const flush = async () => {
      if (!rows.length) return;
      const list = rows;
      rows = [];
      await FLUSH[current](list);
      tick(list.length);
    };
    for await (const r of records(process.stdin)) {
      seen++;
      if (r.kind === 'export') { header = r; continue; }
      if (!ORDER.includes(r.kind)) continue;
      if (r.kind !== current) {
        await flush();
        if (current && ORDER.indexOf(r.kind) < ORDER.indexOf(current)) throw new Error(`The export has ${r.kind} rows after ${current} rows; re-export it with deploy/hub-import/routes.sql.`);
        current = r.kind;
      }
      if (r.kind === 'user') {
        const e = email(r.email);
        if (EMAIL.test(e)) users.set(String(r.id), e);
        continue;
      }
      rows.push(r);
      if (rows.length >= BATCH) await flush();
    }
    await flush();
    if (!seen) throw new Error('No export on stdin. Run deploy/hub-import/run.sh routes user@server.');

    if (DRY) await db('ROLLBACK');
    // Fresh statistics (and no dead rows from the phone pass) so the lists plan well straight away.
    else if (counts.accounts || counts.contacts) await db('VACUUM (ANALYZE) accounts, contacts');

    const secs = ((Date.now() - started) / 1000).toFixed(1);
    const line = (k) => {
      const c = counts[k];
      if (!c) return `${k}: none`;
      return `${k}: ${c.added.toLocaleString('en-US')} added, ${c.updated.toLocaleString('en-US')} updated, ${c.unchanged.toLocaleString('en-US')} already up to date`
        + (c.skipped ? `, ${c.skipped} skipped (their account isn't in the export)` : '');
    };
    console.log('');
    for (const k of ['accounts', 'contacts', 'opportunities', 'activities']) log(line(k));
    if (counts.phones) log(`${counts.phones.toLocaleString('en-US')} account(s) took their main contact's phone number.`);
    log(`People: ${people.matched.size} already in the CRM, ${people.added.size} added as reps${people.added.size ? ` (${[...people.added].join(', ')})` : ''}.`
      + `${people.unknown ? ` ${people.unknown} record(s) whose owner had no email went to ${defaultOwner}.` : ''}`);
    const expected = header?.counts;
    if (expected) {
      const short = ['accounts', 'contacts', 'opportunities', 'activities'].filter((k) => {
        const c = counts[k];
        return Number(expected[k] ?? 0) !== (c ? c.added + c.updated + c.unchanged + c.skipped : 0);
      });
      if (short.length) log(`Not everything arrived: ${short.map((k) => `${k} ${expected[k]} exported`).join(', ')}. Run it again; what is here is kept.`);
    }
    const behind = Object.entries(header?.left_behind ?? {});
    if (behind.length) log(`Left behind (route planning and other SynergyRoutes data): ${behind.map(([t, n]) => `${t} ${n}`).join(', ')}.`);
    log(`Took ${secs}s.`);
    if (DRY) console.log('Dry run: nothing was written.');
  } catch (e) {
    if (DRY) await db('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    client.release();
    await database.close();
  }
}

main().catch((e) => { console.error(e.message ?? e); process.exit(1); });
