/*
 * Demo mode: seeds a fictional company (deploy/demo/content.mjs) and puts it back every hour.
 * Runs as the `demo` service in deploy/compose.yml, in the auth image (for pg and bcryptjs) with
 * this folder mounted at /app/demo. With DEMO_MODE unset it exits at once and does nothing.
 *
 * Each reset, for every app whose tables exist:
 *   auth      the shared demo login gets DEMO_PASSWORD back, MFA and passkeys removed, lockout cleared
 *   calendar  all events replaced by the sample week
 *   notes     all spaces and pages replaced by the sample wiki
 *   chat      all workspaces, channels and messages replaced (user rows are kept)
 *   planner   all workspaces and boards replaced (user rows are kept)
 *   mail      the demo and colleague mailboxes on Stalwart emptied and refilled
 * Everything in those apps is wiped, not just the demo user's data: use demo mode only on an
 * instance that exists to be a demo.
 */
import pg from 'pg';
import bcrypt from 'bcryptjs';
import tls from 'tls';
import { randomBytes } from 'crypto';
import * as content from './content.mjs';

const env = (k, d = '') => (process.env[k] ?? '').trim() || d;
const log = (...a) => console.log(new Date().toISOString(), ...a);

const DOMAIN = env('MAIL_DOMAIN') || env('SUITE_DOMAIN') || 'example.com';
const DEMO_EMAIL = env('DEMO_EMAIL', `demo@${DOMAIN}`).toLowerCase();
const DEMO_PASSWORD = env('DEMO_PASSWORD', 'SynergyDemo1');
const EVERY_MIN = Math.max(5, Number(env('DEMO_RESET_MINUTES', '60')) || 60);

function dbUrl(name) {
  const u = new URL(env('PG_URL', 'postgres://postgres:postgres@postgres:5432'));
  u.pathname = `/${name}`;
  return u.toString();
}

/** Runs fn in one transaction on the app's database; skips (returns false) if `table` is missing. */
async function withDb(name, table, fn) {
  const client = new pg.Client({ connectionString: dbUrl(name) });
  try {
    await client.connect();
  } catch (e) {
    log(`${name}: database not reachable (${e.message}), skipped`);
    return false;
  }
  try {
    const { rows } = await client.query('SELECT to_regclass($1) AS t', [table]);
    if (!rows[0].t) {
      log(`${name}: not set up yet, skipped`);
      return false;
    }
    await client.query('BEGIN');
    await fn(client);
    await client.query('COMMIT');
    return true;
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    await client.end().catch(() => {});
  }
}

// ---- auth --------------------------------------------------------------------------------------

async function resetAuth(p) {
  return withDb('auth', 'sa_users', async (c) => {
    const now = Date.now();
    const hash = await bcrypt.hash(DEMO_PASSWORD, 12);
    const found = await c.query('SELECT id FROM sa_users WHERE email = $1::text', [DEMO_EMAIL]);
    if (found.rows.length) {
      const id = Number(found.rows[0].id);
      await c.query(
        `UPDATE sa_users SET name = $1::text, password_hash = $2::text, role = 'user', disabled = 0,
           mfa_enabled = 0, mfa_secret = NULL, mfa_pending_secret = NULL, backup_codes = NULL, mfa_required = 0,
           failed_logins = 0, locked_until_ms = 0, updated_ms = ${now}
         WHERE id = ${id}`,
        [p.demo.name, hash],
      );
      await c.query(`DELETE FROM sa_passkeys WHERE user_id = ${id}`);
      await c.query(`DELETE FROM sa_reset_tokens WHERE user_id = ${id}`);
    } else {
      await c.query(
        `INSERT INTO sa_users (email, name, password_hash, role, created_ms, updated_ms)
         VALUES ($1::text, $2::text, $3::text, 'user', ${now}, ${now})`,
        [DEMO_EMAIL, p.demo.name, hash],
      );
    }
  });
}

// ---- calendar ----------------------------------------------------------------------------------

async function resetCalendar(p, at) {
  return withDb('calendar', 'events', async (c) => {
    await c.query('DELETE FROM events');
    for (const e of content.calendarEvents(p, at)) {
      await c.query(
        `INSERT INTO events (owner_email, calendar, title, description, location, start_at, end_at, all_day, attendees)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [e.owner, e.calendar, e.title, e.description, e.location, e.start, e.end, e.allDay, JSON.stringify(e.attendees)],
      );
    }
  });
}

// ---- notes -------------------------------------------------------------------------------------

async function resetNotes(p, at) {
  return withDb('notes', 'pages', async (c) => {
    // Not RESTART IDENTITY: the collab server may still hold an open page by id, and must not
    // write it back over a new page that reused the number.
    await c.query('TRUNCATE pages, spaces, labels, templates, notifications CASCADE');
    const space = (await c.query(
      `INSERT INTO spaces (key, name, created_by) VALUES ('GENERAL', 'General', 'system') RETURNING id`,
    )).rows[0].id;
    const ids = new Map();
    let sort = 0;
    for (const page of content.notesPages(p, at)) {
      const by = p[page.by].email;
      const { rows } = await c.query(
        `INSERT INTO pages (title, body, sort, created_by, updated_by, space_id, parent_id)
         VALUES ($1, $2, $3, $4, $4, $5, $6) RETURNING id`,
        [page.title, page.body, sort++, by, space, page.parent ? ids.get(page.parent) : null],
      );
      ids.set(page.title, rows[0].id);
      await c.query(
        `INSERT INTO page_versions (page_id, version_no, title, body, edited_by) VALUES ($1, 1, $2, $3, $4)`,
        [rows[0].id, page.title, page.body, by],
      );
    }
  });
}

// ---- chat --------------------------------------------------------------------------------------

async function resetChat(p) {
  return withDb('chat', 'messages', async (c) => {
    const data = content.chat();
    await c.query('DELETE FROM workspaces');
    await c.query('DELETE FROM channels');
    // User rows stay: the chat server caches them by email, so their ids must not change.
    const uid = {};
    for (const [key, person] of Object.entries(p)) {
      const { rows } = await c.query(
        `INSERT INTO users (email, name) VALUES ($1, $2)
         ON CONFLICT (email) DO UPDATE SET name = EXCLUDED.name RETURNING id`,
        [person.email, person.name],
      );
      uid[key] = Number(rows[0].id);
    }
    const ws = (await c.query(
      `INSERT INTO workspaces (name, slug, created_by) VALUES ($1, 'juniper-bay', $2) RETURNING id`,
      [content.COMPANY, uid.priya],
    )).rows[0].id;
    // Everyone who has used chat (the admin, say) is back in the company workspace and #general.
    await c.query('INSERT INTO workspace_members (workspace_id, user_id) SELECT $1, id FROM users', [ws]);

    const channel = {};
    for (const ch of data.channels) {
      channel[ch.name] = (await c.query(
        `INSERT INTO channels (kind, name, topic, workspace_id, created_by) VALUES ('public', $1, $2, $3, $4) RETURNING id`,
        [ch.name, ch.topic, ws, uid.priya],
      )).rows[0].id;
      if (ch.members === 'all') {
        await c.query('INSERT INTO channel_members (channel_id, user_id) SELECT $1, id FROM users', [channel[ch.name]]);
      } else {
        for (const k of ch.members) {
          await c.query('INSERT INTO channel_members (channel_id, user_id) VALUES ($1, $2)', [channel[ch.name], uid[k]]);
        }
      }
    }
    const dm = async (other) => {
      const key = [Math.min(uid.demo, uid[other]), Math.max(uid.demo, uid[other])].join(':');
      if (!channel[key]) {
        channel[key] = (await c.query(
          `INSERT INTO channels (kind, dm_key, created_by, workspace_id) VALUES ('dm', $1, $2, $3) RETURNING id`,
          [key, uid[other], ws],
        )).rows[0].id;
        for (const u of [uid.demo, uid[other]]) {
          await c.query('INSERT INTO channel_members (channel_id, user_id) VALUES ($1, $2)', [channel[key], u]);
        }
      }
      return channel[key];
    };
    const now = Date.now();
    for (const m of data.messages) {
      const ch = m.dm ? await dm(m.dm) : channel[m.channel];
      await c.query(
        'INSERT INTO messages (channel_id, user_id, body, created_at) VALUES ($1, $2, $3, $4)',
        [ch, uid[m.from], m.body, new Date(now - m.ago * 60_000)],
      );
    }
  });
}

// ---- planner -----------------------------------------------------------------------------------

async function resetPlanner(p, at) {
  let demoSub = null;
  await withDb('auth', 'sa_users', async (c) => {
    const { rows } = await c.query('SELECT id FROM sa_users WHERE email = $1::text', [DEMO_EMAIL]);
    demoSub = rows[0] ? String(rows[0].id) : null;
  });
  return withDb('planner', 'cards', async (c) => {
    await c.query('DELETE FROM workspaces');
    await c.query('DELETE FROM saved_filters');
    await c.query('DELETE FROM notifications');
    // User rows stay. Planner keys them on the OIDC subject the gateway passes on, which for the
    // demo login is its id in auth; the colleagues never sign in, so their email stands in.
    const uid = {};
    for (const [key, person] of Object.entries(p)) {
      const sub = (key === 'demo' && demoSub) || person.email;
      const found = await c.query('SELECT id FROM users WHERE auth_sub = $1', [sub]);
      uid[key] = found.rows[0]?.id ?? (await c.query(
        'INSERT INTO users (auth_sub, email, name) VALUES ($1, $2, $3) RETURNING id', [sub, person.email, person.name],
      )).rows[0].id;
    }
    const ws = (await c.query(
      `INSERT INTO workspaces (name, slug) VALUES ($1, 'juniper-bay') RETURNING id`, [content.COMPANY],
    )).rows[0].id;
    for (const key of Object.keys(p)) {
      await c.query('INSERT INTO workspace_members (workspace_id, user_id, role) VALUES ($1, $2, $3)',
        [ws, uid[key], key === 'priya' ? 'owner' : 'admin']);
    }

    for (const b of content.plannerBoards()) {
      const board = (await c.query(
        `INSERT INTO boards (workspace_id, title, background, key_prefix, seq, created_by)
         VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
        [ws, b.title, b.background, b.key, b.cards.length, uid[b.owner]],
      )).rows[0].id;
      for (const k of b.members) {
        await c.query('INSERT INTO board_members (board_id, user_id, role) VALUES ($1, $2, $3)',
          [board, uid[k], k === b.owner ? 'owner' : 'member']);
      }
      const list = {};
      for (const [i, [title, category]] of b.lists.entries()) {
        list[title] = (await c.query(
          'INSERT INTO lists (board_id, title, position, status_category) VALUES ($1, $2, $3, $4) RETURNING id',
          [board, title, (i + 1) * 1024, category],
        )).rows[0].id;
      }
      const label = {};
      for (const [name, color] of b.labels) {
        label[name] = (await c.query('INSERT INTO labels (board_id, name, color) VALUES ($1, $2, $3) RETURNING id',
          [board, name, color])).rows[0].id;
      }
      const pos = {};
      for (const [i, card] of b.cards.entries()) {
        pos[card.list] = (pos[card.list] ?? 0) + 1024;
        const due = at(card.due, 17);
        const id = (await c.query(
          `INSERT INTO cards (list_id, board_id, title, description, position, due_date, is_complete, completed_at,
             resolution, issue_key, issue_type, priority, points, assignee_id, reporter_id, created_by)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $15) RETURNING id`,
          [list[card.list], board, card.title, card.description ?? null, pos[card.list], due, !!card.done,
            card.done ? due : null, card.done ? 'done' : null, `${b.key}-${i + 1}`, card.type ?? 'task',
            card.priority ?? 'medium', card.points ?? null, uid[card.assignee], uid[b.owner]],
        )).rows[0].id;
        await c.query('INSERT INTO card_members (card_id, user_id) VALUES ($1, $2)', [id, uid[card.assignee]]);
        for (const name of card.labels ?? []) {
          await c.query('INSERT INTO card_labels (card_id, label_id) VALUES ($1, $2)', [id, label[name]]);
        }
        if (card.checklist) {
          const cl = (await c.query('INSERT INTO checklists (card_id, title, position) VALUES ($1, $2, 1024) RETURNING id',
            [id, 'Checklist'])).rows[0].id;
          for (const [j, text] of card.checklist.entries()) {
            await c.query('INSERT INTO checklist_items (checklist_id, text, is_checked, position) VALUES ($1, $2, $3, $4)',
              [cl, text, j < (card.checked ?? 0), (j + 1) * 1024]);
          }
        }
        if (card.comment) {
          await c.query('INSERT INTO comments (card_id, user_id, body) VALUES ($1, $2, $3)',
            [id, uid[card.comment.from], card.comment.body]);
        }
        await c.query(`INSERT INTO activities (board_id, card_id, user_id, type, data) VALUES ($1, $2, $3, 'card_created', $4)`,
          [board, id, uid[b.owner], JSON.stringify({ title: card.title })]);
      }
    }
  });
}

// ---- mail --------------------------------------------------------------------------------------

/** Creates a mailbox on Stalwart if it is missing, as apps/mail/lib/provision.ts does. */
async function ensureMailbox(email, name) {
  const url = env('MAIL_ADMIN_URL').replace(/\/$/, '');
  const auth = Buffer.from(`${env('MAIL_ADMIN_USER', 'admin')}:${env('MAIL_ADMIN_PASSWORD')}`).toString('base64');
  const call = async (method, args) => {
    const res = await fetch(`${url}/jmap/`, {
      method: 'POST',
      headers: { authorization: `Basic ${auth}`, 'content-type': 'application/json' },
      body: JSON.stringify({ using: ['urn:ietf:params:jmap:core', 'urn:stalwart:jmap'], methodCalls: [[method, args, 'c']] }),
    });
    if (!res.ok) throw new Error(`mail server admin API: HTTP ${res.status}`);
    const [kind, out] = (await res.json()).methodResponses?.[0] ?? [];
    if (kind === 'error') throw new Error(`mail server admin API: ${JSON.stringify(out)}`);
    return out;
  };
  const [local, domain] = email.split('@');
  const domainId = (await call('x:Domain/query', { filter: { name: domain } }))?.ids?.[0];
  if (!domainId) throw new Error(`the mail server does not host ${domain}`);
  if ((await call('x:Account/query', { filter: { name: local, domainId } }))?.ids?.length) return;
  const out = await call('x:Account/set', {
    create: { u: {
      '@type': 'User', name: local, domainId, description: name,
      credentials: { 0: { '@type': 'Password', secret: randomBytes(24).toString('base64url') } },
    } },
  });
  if (!out?.created?.u) throw new Error(`could not create mailbox ${email}: ${JSON.stringify(out?.notCreated)}`);
}

/** The few IMAP commands the reset needs, over TLS, with literals in responses inlined as strings. */
async function imapConnect({ host, port, user, pass }) {
  const sock = tls.connect({ host, port, rejectUnauthorized: env('MAIL_SUITE_TLS_INSECURE', 'true') === 'false' });
  let buf = Buffer.alloc(0);
  let wake = null;
  let failed = null;
  const poke = () => { const w = wake; wake = null; w?.(); };
  sock.on('data', (d) => { buf = Buffer.concat([buf, d]); poke(); });
  sock.on('error', (e) => { failed = e; poke(); });
  sock.on('close', () => { failed ??= new Error('IMAP connection closed'); poke(); });
  const more = () => {
    if (failed) throw failed;
    return new Promise((r) => { wake = r; });
  };
  async function line() {
    let out = '';
    for (;;) {
      const i = buf.indexOf('\r\n');
      if (i < 0) { await more(); continue; }
      const l = buf.subarray(0, i).toString('utf8');
      const lit = /\{(\d+)\}$/.exec(l);
      if (lit) {
        const n = Number(lit[1]);
        if (buf.length < i + 2 + n) { await more(); continue; }
        out += l.slice(0, -lit[0].length) + JSON.stringify(buf.subarray(i + 2, i + 2 + n).toString('utf8'));
        buf = buf.subarray(i + 2 + n);
        continue;
      }
      buf = buf.subarray(i + 2);
      return out + l;
    }
  }
  let n = 0;
  async function cmd(text, literal) {
    const tag = `D${++n}`;
    const untagged = [];
    if (literal) {
      sock.write(`${tag} ${text} {${literal.length}}\r\n`);
      for (;;) {
        const l = await line();
        if (l.startsWith('+')) break;
        if (l.startsWith(`${tag} `)) throw new Error(`IMAP ${text.split(' ')[0]}: ${l}`);
      }
      sock.write(literal);
      sock.write('\r\n');
    } else {
      sock.write(`${tag} ${text}\r\n`);
    }
    for (;;) {
      const l = await line();
      if (!l.startsWith(`${tag} `)) { untagged.push(l); continue; }
      if (!/^\S+ OK/i.test(l)) throw new Error(`IMAP ${text.split(' ')[0]}: ${l}`);
      return untagged;
    }
  }
  await line(); // greeting
  await cmd(`LOGIN ${q(user)} ${q(pass)}`);
  return { cmd, close: () => { sock.end(); } };
}

const q = (s) => `"${String(s).replace(/["\\]/g, '\\$&')}"`;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const pad = (n) => String(n).padStart(2, '0');
const imapDate = (d) =>
  `${pad(d.getUTCDate())}-${MONTHS[d.getUTCMonth()]}-${d.getUTCFullYear()} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())} +0000`;

/** Empties every folder of a mailbox and deletes folders visitors created. Returns special folders. */
async function emptyMailbox(imap) {
  const special = {};
  const folders = [];
  for (const l of await imap.cmd('LIST "" "*"')) {
    const m = /^\* LIST \(([^)]*)\) (?:"(?:[^"\\]|\\.)*"|NIL) (.+)$/i.exec(l);
    if (!m) continue;
    const flags = m[1].toLowerCase();
    const name = m[2].startsWith('"') ? JSON.parse(m[2]) : m[2];
    if (flags.includes('\\noselect')) continue;
    const use = /\\(sent|drafts|trash|junk|archive)/.exec(flags)?.[1];
    if (use) special[use] = name;
    folders.push({ name, keep: !!use || name.toUpperCase() === 'INBOX' });
  }
  for (const f of folders.sort((a, b) => b.name.length - a.name.length)) {
    if (!f.keep) { await imap.cmd(`DELETE ${q(f.name)}`); continue; }
    const exists = (await imap.cmd(`SELECT ${q(f.name)}`)).map((l) => /^\* (\d+) EXISTS/i.exec(l)).find(Boolean);
    if (exists && Number(exists[1]) > 0) {
      await imap.cmd('STORE 1:* +FLAGS.SILENT (\\Deleted)');
      await imap.cmd('EXPUNGE');
    }
  }
  await imap.cmd('UNSELECT').catch(() => imap.cmd('CLOSE'));
  return special;
}

function rfc822(m, p, date, id) {
  const addr = (k) => `${p[k].name} <${p[k].email}>`;
  const headers = [
    `From: ${addr(m.from)}`,
    `To: ${m.to.map(addr).join(', ')}`,
    ...(m.cc ? [`Cc: ${m.cc.map(addr).join(', ')}`] : []),
    `Subject: ${m.subject}`,
    `Date: ${date.toUTCString().replace('GMT', '+0000')}`,
    `Message-ID: <demo-${id}@${DOMAIN}>`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=utf-8',
    'Content-Transfer-Encoding: 8bit',
  ];
  return Buffer.from(`${headers.join('\r\n')}\r\n\r\n${m.body.replace(/\r?\n/g, '\r\n')}\r\n`, 'utf8');
}

async function resetMail(p) {
  const host = env('MAIL_IMAP_HOST');
  const master = env('MAIL_MASTER_USER');
  if (!host || !master || !env('MAIL_ADMIN_URL')) {
    log('mail: not configured, skipped');
    return false;
  }
  const messages = content.mailMessages();
  const now = Date.now();
  for (const [key, person] of Object.entries(p)) {
    await ensureMailbox(person.email, person.name);
    const imap = await imapConnect({
      host, port: Number(env('MAIL_IMAP_PORT', '993')), user: `${person.email}%${master}`, pass: env('MAIL_MASTER_PASSWORD'),
    });
    try {
      const special = await emptyMailbox(imap);
      if (key !== 'demo') continue;
      for (const [i, m] of messages.entries()) {
        const date = new Date(now - m.ago * 3_600_000);
        const folder = m.folder === 'sent' ? (special.sent ?? 'Sent Items') : 'INBOX';
        await imap.cmd(`APPEND ${q(folder)} (${m.seen ? '\\Seen' : ''}) "${imapDate(date)}"`, rfc822(m, p, date, i + 1));
      }
    } finally {
      imap.close();
    }
  }
  return true;
}

// ---- loop --------------------------------------------------------------------------------------

async function resetAll(only) {
  const list = content.people(DOMAIN, DEMO_EMAIL);
  const p = Object.fromEntries(list.map((x) => [x.key, x]));
  const { at } = content.week();
  const steps = { auth: () => resetAuth(p), calendar: () => resetCalendar(p, at), notes: () => resetNotes(p, at),
    chat: () => resetChat(p), planner: () => resetPlanner(p, at), mail: () => resetMail(p) };
  const pending = [];
  for (const [name, step] of Object.entries(steps)) {
    if (only && !only.includes(name)) continue;
    try {
      if (await step()) log(`${name}: reset`);
      else pending.push(name);
    } catch (e) {
      log(`${name}: reset failed: ${e instanceof Error ? e.message : e}`);
      pending.push(name);
    }
  }
  return pending;
}

async function main() {
  if (env('DEMO_MODE') !== '1') {
    console.log('Demo mode is off (DEMO_MODE is not 1); nothing to do.');
    return;
  }
  log(`demo mode: ${DEMO_EMAIL}, reset every ${EVERY_MIN} minutes`);
  // On a fresh start the apps create their tables a little after they boot: retry what was
  // skipped for a few minutes so the first visitors see the sample content.
  let pending = await resetAll();
  for (let i = 0; pending.length && i < 20; i++) {
    await new Promise((r) => setTimeout(r, 15_000));
    log(`retrying: ${pending.join(', ')}`);
    pending = await resetAll(pending);
  }
  const every = EVERY_MIN * 60_000;
  for (;;) {
    // On the hour (or the next multiple of DEMO_RESET_MINUTES), so the sign-in page can say when.
    await new Promise((r) => setTimeout(r, every - (Date.now() % every)));
    await resetAll();
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
