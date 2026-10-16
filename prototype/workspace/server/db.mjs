// Synergy Workspace — storage layer.
// node:sqlite ships with Node 22, so the whole suite runs with zero npm deps.
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DATA = join(ROOT, 'data');
mkdirSync(DATA, { recursive: true });

export const db = new DatabaseSync(join(DATA, 'workspace.db'));
db.exec('PRAGMA journal_mode = WAL');
db.exec('PRAGMA foreign_keys = ON');

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY, email TEXT UNIQUE NOT NULL, name TEXT NOT NULL,
  avatar_color TEXT DEFAULT '#0b57d0', role TEXT DEFAULT 'member',
  org_unit TEXT DEFAULT '/', suspended INTEGER DEFAULT 0,
  storage_used INTEGER DEFAULT 0, created INTEGER
);

-- Drive is the substrate: Docs/Sheets/Slides/Forms are all rows here.
CREATE TABLE IF NOT EXISTS files (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, mime TEXT NOT NULL,
  parent TEXT, owner TEXT NOT NULL, starred INTEGER DEFAULT 0,
  trashed INTEGER DEFAULT 0, size INTEGER DEFAULT 0,
  content TEXT, thumb TEXT,
  created INTEGER, modified INTEGER, modified_by TEXT,
  shared_mode TEXT DEFAULT 'restricted'
);
CREATE INDEX IF NOT EXISTS idx_files_parent ON files(parent, trashed);
CREATE INDEX IF NOT EXISTS idx_files_owner  ON files(owner, trashed);
CREATE INDEX IF NOT EXISTS idx_files_mime   ON files(mime);

CREATE TABLE IF NOT EXISTS permissions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  file_id TEXT NOT NULL, user_email TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'reader', created INTEGER,
  UNIQUE(file_id, user_email)
);

CREATE TABLE IF NOT EXISTS revisions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  file_id TEXT NOT NULL, content TEXT, author TEXT,
  created INTEGER, label TEXT
);
CREATE INDEX IF NOT EXISTS idx_rev_file ON revisions(file_id, created DESC);

CREATE TABLE IF NOT EXISTS comments (
  id TEXT PRIMARY KEY, file_id TEXT NOT NULL, anchor TEXT,
  author TEXT, body TEXT, resolved INTEGER DEFAULT 0,
  parent_id TEXT, created INTEGER
);
CREATE INDEX IF NOT EXISTS idx_cmt_file ON comments(file_id, resolved);

-- Calendar
CREATE TABLE IF NOT EXISTS calendars (
  id TEXT PRIMARY KEY, name TEXT, owner TEXT, color TEXT DEFAULT '#0b57d0',
  visible INTEGER DEFAULT 1, primary_cal INTEGER DEFAULT 0
);
CREATE TABLE IF NOT EXISTS events (
  id TEXT PRIMARY KEY, calendar_id TEXT NOT NULL, title TEXT,
  description TEXT, location TEXT, start INTEGER, end INTEGER,
  all_day INTEGER DEFAULT 0, rrule TEXT, color TEXT,
  meet_link TEXT, organizer TEXT, created INTEGER
);
CREATE INDEX IF NOT EXISTS idx_ev_cal ON events(calendar_id, start);
CREATE TABLE IF NOT EXISTS attendees (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_id TEXT NOT NULL, email TEXT, response TEXT DEFAULT 'needsAction', optional INTEGER DEFAULT 0
);

-- Keep
CREATE TABLE IF NOT EXISTS notes (
  id TEXT PRIMARY KEY, owner TEXT, title TEXT, body TEXT,
  color TEXT DEFAULT 'default', pinned INTEGER DEFAULT 0,
  archived INTEGER DEFAULT 0, trashed INTEGER DEFAULT 0,
  checklist TEXT, labels TEXT, created INTEGER, modified INTEGER
);

-- Tasks
CREATE TABLE IF NOT EXISTS task_lists (
  id TEXT PRIMARY KEY, owner TEXT, name TEXT, position INTEGER DEFAULT 0
);
CREATE TABLE IF NOT EXISTS tasks (
  id TEXT PRIMARY KEY, list_id TEXT NOT NULL, title TEXT, notes TEXT,
  due INTEGER, completed INTEGER DEFAULT 0, completed_at INTEGER,
  parent_id TEXT, position INTEGER DEFAULT 0, starred INTEGER DEFAULT 0, created INTEGER
);

-- Contacts
CREATE TABLE IF NOT EXISTS contacts (
  id TEXT PRIMARY KEY, owner TEXT, name TEXT, email TEXT, phone TEXT,
  company TEXT, job_title TEXT, notes TEXT, starred INTEGER DEFAULT 0,
  labels TEXT, photo_color TEXT, created INTEGER, modified INTEGER
);

-- Mail
CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY, thread_id TEXT, owner TEXT,
  sender TEXT, sender_name TEXT, recipients TEXT, cc TEXT, bcc TEXT,
  subject TEXT, body TEXT, snippet TEXT,
  labels TEXT DEFAULT 'INBOX', unread INTEGER DEFAULT 1,
  starred INTEGER DEFAULT 0, important INTEGER DEFAULT 0,
  attachments TEXT, sent_at INTEGER, draft INTEGER DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_msg_owner ON messages(owner, sent_at DESC);
CREATE INDEX IF NOT EXISTS idx_msg_thread ON messages(thread_id);

-- Chat
CREATE TABLE IF NOT EXISTS spaces (
  id TEXT PRIMARY KEY, name TEXT, type TEXT DEFAULT 'room',
  members TEXT, created INTEGER, last_activity INTEGER
);
CREATE TABLE IF NOT EXISTS chat_messages (
  id TEXT PRIMARY KEY, space_id TEXT NOT NULL, author TEXT, author_name TEXT,
  body TEXT, thread_id TEXT, reactions TEXT, sent_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_chat_space ON chat_messages(space_id, sent_at);

-- Forms
CREATE TABLE IF NOT EXISTS form_responses (
  id TEXT PRIMARY KEY, form_id TEXT NOT NULL, respondent TEXT,
  answers TEXT, submitted INTEGER
);
CREATE INDEX IF NOT EXISTS idx_fresp ON form_responses(form_id);

-- Meet
CREATE TABLE IF NOT EXISTS meetings (
  id TEXT PRIMARY KEY, code TEXT UNIQUE, title TEXT, host TEXT,
  participants TEXT, started INTEGER, ended INTEGER, recording TEXT
);

-- Admin / audit
CREATE TABLE IF NOT EXISTS audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  actor TEXT, app TEXT, action TEXT, target TEXT, detail TEXT, at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_audit_at ON audit_log(at DESC);

CREATE TABLE IF NOT EXISTS groups_tbl (
  id TEXT PRIMARY KEY, email TEXT UNIQUE, name TEXT, description TEXT,
  members TEXT, access TEXT DEFAULT 'restricted', created INTEGER
);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY, value TEXT
);
`);

// ---------- helpers ----------
export const now = () => Date.now();
export const uid = (p = '') =>
  p + Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);

export function all(sql, ...p) { return db.prepare(sql).all(...p); }
export function get(sql, ...p) { return db.prepare(sql).get(...p); }
export function run(sql, ...p) { return db.prepare(sql).run(...p); }

export function audit(actor, app, action, target, detail = '') {
  run('INSERT INTO audit_log(actor,app,action,target,detail,at) VALUES(?,?,?,?,?,?)',
    actor, app, action, target, detail, now());
}

export const MIME = {
  folder: 'application/vnd.synergy-apps.folder',
  doc:    'application/vnd.synergy-apps.document',
  sheet:  'application/vnd.synergy-apps.spreadsheet',
  slide:  'application/vnd.synergy-apps.presentation',
  form:   'application/vnd.synergy-apps.form',
  site:   'application/vnd.synergy-apps.site',
  drawing:'application/vnd.synergy-apps.drawing',
};

// ---------- seed ----------
function seed() {
  if (get('SELECT COUNT(*) c FROM users').c > 0) return;
  const t = now(), day = 86400000;

  const users = [
    ['u_shane', 'shane@example.com', 'Shane Ansel', '#0b57d0', 'superadmin'],
    ['u_logan', 'logan@example.com', 'Logan Ansel', '#188038', 'member'],
    ['u_dana',  'dana@example.com',  'Dana Reyes',  '#d93025', 'admin'],
    ['u_miguel','miguel@example.com','Miguel Ortiz','#f9ab00', 'member'],
    ['u_priya', 'priya@example.com', 'Priya Nair',  '#9334e6', 'member'],
  ];
  for (const [id, email, name, color, role] of users)
    run('INSERT INTO users(id,email,name,avatar_color,role,created) VALUES(?,?,?,?,?,?)',
      id, email, name, color, role, t);

  const me = 'shane@example.com';

  // Drive tree
  const folders = [
    ['f_work', 'Work', null], ['f_2026', '2026 Planning', 'f_work'],
    ['f_fin', 'Finance', null], ['f_eng', 'Engineering', 'f_work'],
    ['f_shared', 'Shared with team', null],
  ];
  for (const [id, name, parent] of folders)
    run(`INSERT INTO files(id,name,mime,parent,owner,created,modified,modified_by)
         VALUES(?,?,?,?,?,?,?,?)`, id, name, MIME.folder, parent, me, t - day * 30, t - day * 2, me);

  const docBody = (title, paras) => JSON.stringify({
    title,
    blocks: paras.map(p => (typeof p === 'string'
      ? { type: 'p', text: p }
      : p)),
  });

  const files = [
    ['d_roadmap', 'Q1 Product Roadmap', MIME.doc, 'f_2026', docBody('Q1 Product Roadmap', [
      { type: 'h1', text: 'Q1 Product Roadmap' },
      'This quarter we consolidate the suite behind a single shell and a single identity provider.',
      { type: 'h2', text: 'Objectives' },
      { type: 'li', text: 'Ship the unified app switcher across all sixteen apps' },
      { type: 'li', text: 'Move every app onto SynergyAuth SSO' },
      { type: 'li', text: 'Reach feature parity with the incumbent suite on Docs, Sheets and Slides' },
      { type: 'h2', text: 'Risks' },
      'Storage migration is the long pole. The Drive substrate has to carry Docs, Sheets, Slides and Forms as first-class rows before any of the editors can be considered done.',
    ])],
    ['d_notes', 'Weekly Sync Notes', MIME.doc, 'f_work', docBody('Weekly Sync Notes', [
      { type: 'h1', text: 'Weekly Sync — Engineering' },
      'Attendees: Shane, Dana, Miguel, Priya',
      { type: 'li', text: 'Sheets formula engine landed — 60 functions' },
      { type: 'li', text: 'Slides presenter view still open' },
      'Next review Thursday.',
    ])],
    ['d_prop', 'Client Proposal — Northwind', MIME.doc, 'f_work', docBody('Client Proposal', [
      { type: 'h1', text: 'Proposal for Northwind Health' },
      'Prepared by Synergy Technologies.',
      'We propose a phased rollout across three sites over ten weeks.',
    ])],
    ['s_budget', '2026 Budget', MIME.sheet, 'f_fin', null],
    ['s_metrics', 'Product Metrics', MIME.sheet, 'f_fin', null],
    ['p_qbr', 'Q4 Business Review', MIME.slide, 'f_work', null],
    ['p_pitch', 'Investor Pitch', MIME.slide, null, null],
    ['fm_survey', 'Customer Satisfaction Survey', MIME.form, null, null],
  ];
  for (const [id, name, mime, parent, content] of files)
    run(`INSERT INTO files(id,name,mime,parent,owner,content,size,created,modified,modified_by)
         VALUES(?,?,?,?,?,?,?,?,?,?)`,
      id, name, mime, parent, me, content, (content || '').length,
      t - day * 12, Math.trunc(t - day * (1 + Math.random() * 6)), me);

  // Uploaded binaries — Drive has to show non-native files too
  const uploads = [
    ['u_deck', 'Kickoff Deck.pdf', 'application/pdf', 2_400_000],
    ['u_logo', 'brand-logo.png', 'image/png', 184_000],
    ['u_csv', 'export-2026-08.csv', 'text/csv', 44_000],
    ['u_vid', 'demo-walkthrough.mp4', 'video/mp4', 38_000_000],
  ];
  for (const [id, name, mime, size] of uploads)
    run(`INSERT INTO files(id,name,mime,parent,owner,size,created,modified,modified_by)
         VALUES(?,?,?,?,?,?,?,?,?)`, id, name, mime, 'f_shared', me, size,
      t - day * 20, t - day * 4, me);

  for (const e of ['dana@example.com', 'miguel@example.com'])
    for (const f of ['d_roadmap', 's_budget', 'f_shared'])
      run('INSERT OR IGNORE INTO permissions(file_id,user_email,role,created) VALUES(?,?,?,?)',
        f, e, 'writer', t);

  // Calendar
  run(`INSERT INTO calendars(id,name,owner,color,primary_cal) VALUES(?,?,?,?,1)`,
    'cal_me', 'Shane Ansel', me, '#0b57d0');
  run(`INSERT INTO calendars(id,name,owner,color) VALUES(?,?,?,?)`,
    'cal_team', 'Engineering', me, '#188038');
  run(`INSERT INTO calendars(id,name,owner,color) VALUES(?,?,?,?)`,
    'cal_ooo', 'Out of office', me, '#f9ab00');

  const d0 = new Date(); d0.setHours(0, 0, 0, 0);
  const at = (dayOff, h, m = 0) => d0.getTime() + dayOff * day + h * 3600000 + m * 60000;
  const evs = [
    ['cal_team', 'Engineering standup', at(0, 9, 30), at(0, 9, 45), 'Recurring daily'],
    ['cal_me', 'Design review — Sheets', at(0, 11), at(0, 12), 'Formula bar + frozen panes'],
    ['cal_me', 'Lunch', at(0, 12, 30), at(0, 13, 30), ''],
    ['cal_team', '1:1 with Dana', at(0, 14), at(0, 14, 30), ''],
    ['cal_me', 'Northwind kickoff', at(1, 10), at(1, 11, 30), 'Bring the proposal'],
    ['cal_team', 'Sprint planning', at(1, 13), at(1, 14, 30), ''],
    ['cal_me', 'Investor call', at(2, 15), at(2, 16), ''],
    ['cal_team', 'Retro', at(4, 16), at(4, 17), ''],
    ['cal_me', 'Quarterly offsite', at(3, 9), at(3, 17), 'All day planning'],
    ['cal_team', 'Release freeze', at(-1, 17), at(-1, 18), ''],
  ];
  for (const [cal, title, s, e, desc] of evs) {
    const id = uid('ev_');
    run(`INSERT INTO events(id,calendar_id,title,description,start,end,organizer,meet_link,created)
         VALUES(?,?,?,?,?,?,?,?,?)`, id, cal, title, desc, s, e, me,
      'meet.example.com/' + uid().slice(0, 10), t);
    run('INSERT INTO attendees(event_id,email,response) VALUES(?,?,?)', id, me, 'accepted');
    if (cal === 'cal_team')
      for (const a of ['dana@example.com', 'miguel@example.com'])
        run('INSERT INTO attendees(event_id,email,response) VALUES(?,?,?)', id, a, 'accepted');
  }

  // Keep
  const notes = [
    ['Suite launch checklist', '', 'yellow', 1,
      JSON.stringify([{ t: 'App switcher on every app', d: 1 }, { t: 'Dark theme audit', d: 0 },
      { t: 'Keyboard shortcuts', d: 0 }, { t: 'Offline cache', d: 0 }])],
    ['Sheets functions still missing', 'XLOOKUP, QUERY, ARRAYFORMULA, SPARKLINE', 'blue', 1, null],
    ['Groceries', '', 'green', 0, JSON.stringify([{ t: 'Coffee', d: 0 }, { t: 'Oat milk', d: 1 }])],
    ['Interview questions', 'Ask about distributed systems experience and on-call history.', 'default', 0, null],
    ['Domain renewals', 'example.com expires 2026-09-25 — renew before the 20th.', 'red', 0, null],
  ];
  for (const [title, body, color, pinned, checklist] of notes)
    run(`INSERT INTO notes(id,owner,title,body,color,pinned,checklist,created,modified)
         VALUES(?,?,?,?,?,?,?,?,?)`, uid('n_'), me, title, body, color, pinned, checklist,
      Math.trunc(t - day * Math.random() * 10), t);

  // Tasks
  run('INSERT INTO task_lists(id,owner,name,position) VALUES(?,?,?,0)', 'tl_my', me, 'My Tasks');
  run('INSERT INTO task_lists(id,owner,name,position) VALUES(?,?,?,1)', 'tl_ship', me, 'Suite launch');
  const tks = [
    ['tl_my', 'Review Northwind proposal', at(0, 17), 0],
    ['tl_my', 'Rotate the Printify token', at(1, 12), 0],
    ['tl_my', 'Book flights for offsite', null, 1],
    ['tl_ship', 'Finish Slides presenter view', at(2, 12), 0],
    ['tl_ship', 'Add frozen panes to Sheets', null, 0],
    ['tl_ship', 'Wire Forms to Sheets responses', at(5, 12), 0],
  ];
  for (const [list, title, due, done] of tks)
    run(`INSERT INTO tasks(id,list_id,title,due,completed,created) VALUES(?,?,?,?,?,?)`,
      uid('tk_'), list, title, due, done, t);

  // Contacts
  const cts = [
    ['Dana Reyes', 'dana@example.com', '+1 910 555 0142', 'Synergy Technologies', 'Engineering Manager', 1],
    ['Miguel Ortiz', 'miguel@example.com', '+1 910 555 0177', 'Synergy Technologies', 'Staff Engineer', 1],
    ['Priya Nair', 'priya@example.com', '+1 910 555 0190', 'Synergy Technologies', 'Product Designer', 0],
    ['Logan Ansel', 'logan@example.com', '+1 910 555 0101', 'Beachlife Co', 'Founder', 1],
    ['Ellen Park', 'ellen@northwindhealth.com', '+1 415 555 0113', 'Northwind Health', 'VP Operations', 0],
    ['Tom Bradley', 'tom@northwindhealth.com', '+1 415 555 0128', 'Northwind Health', 'CTO', 0],
    ['Ana Silva', 'ana@vendorco.io', '+1 212 555 0164', 'VendorCo', 'Account Executive', 0],
  ];
  const colors = ['#0b57d0', '#188038', '#d93025', '#f9ab00', '#9334e6', '#00897b', '#e8710a'];
  cts.forEach(([name, email, phone, company, title, star], i) =>
    run(`INSERT INTO contacts(id,owner,name,email,phone,company,job_title,starred,photo_color,created,modified)
         VALUES(?,?,?,?,?,?,?,?,?,?,?)`, uid('c_'), me, name, email, phone, company, title,
      star, colors[i % colors.length], t, t));

  // Mail
  const mails = [
    ['Ellen Park', 'ellen@northwindhealth.com', 'Re: Kickoff next Tuesday',
      'Shane,\n\nTuesday at 10 works for our side. I have looped in Tom so he can speak to the integration questions.\n\nOne thing — could you bring the phased rollout timeline? The board asked for dates.\n\nBest,\nEllen', 'INBOX', 1, 1, 0],
    ['Dana Reyes', 'dana@example.com', 'Sheets formula engine is green',
      'All 60 functions pass. VLOOKUP with approximate match was the last holdout — fixed the binary search bound.\n\nMoving to frozen panes next.\n\n— Dana', 'INBOX', 1, 0, 1],
    ['Miguel Ortiz', 'miguel@example.com', 'Slides: presenter view design',
      'Mocked up the speaker notes pane. Do we want the next-slide preview on the left or right? Google puts it on the left.\n\nMiguel', 'INBOX', 1, 0, 0],
    ['Synergy Security', 'security@example.com', 'Certificate expiring in 15 days',
      'The certificate for example.com expires on 2026-09-25.\n\nAuto-renewal is configured but has not yet run. No action needed unless you see this again next week.', 'INBOX', 0, 0, 1],
    ['Priya Nair', 'priya@example.com', 'Dark theme audit — 11 issues',
      'Found 11 places where we hardcode a light surface. Filed them all. The worst is the Sheets grid — the gridlines vanish entirely.\n\nPriya', 'INBOX', 1, 1, 0],
    ['Tom Bradley', 'tom@northwindhealth.com', 'Security questionnaire',
      'Attaching our standard vendor questionnaire. Turnaround is usually two weeks.\n\nTom', 'INBOX', 0, 0, 0],
    ['Logan Ansel', 'logan@example.com', 'Dinner?',
      'Are you going to surface from the computer tonight? :)', 'INBOX', 1, 1, 0],
    ['Ana Silva', 'ana@vendorco.io', 'Following up on our conversation',
      'Just checking in to see if you had a chance to review the pricing I sent over.', 'INBOX', 0, 0, 0],
    ['Synergy Billing', 'billing@example.com', 'Your August invoice',
      'Invoice #2026-08-441 for $1,240.00 is available.', 'INBOX', 0, 0, 0],
    ['Shane Ansel', me, 'Re: Sheets formula engine is green',
      'Great work. Ship it.', 'SENT', 0, 0, 0],
  ];
  mails.forEach(([sname, sender, subject, body, label, unread, starred, important], i) => {
    const id = uid('m_');
    run(`INSERT INTO messages(id,thread_id,owner,sender,sender_name,recipients,subject,body,snippet,
         labels,unread,starred,important,sent_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      id, id, me, sender, sname, me, subject, body,
      body.replace(/\n+/g, ' ').slice(0, 120), label, unread, starred, important,
      Math.trunc(t - i * 3.4 * 3600000));
  });

  // Chat
  const sps = [
    ['sp_eng', 'Engineering', 'room'],
    ['sp_launch', 'Suite launch', 'room'],
    ['sp_dana', 'Dana Reyes', 'dm'],
    ['sp_logan', 'Logan Ansel', 'dm'],
  ];
  for (const [id, name, type] of sps)
    run('INSERT INTO spaces(id,name,type,members,created,last_activity) VALUES(?,?,?,?,?,?)',
      id, name, type, JSON.stringify([me, 'dana@example.com', 'miguel@example.com']), t, t);
  const chats = [
    ['sp_eng', 'dana@example.com', 'Dana Reyes', 'Formula engine is green — 60/60.', 40],
    ['sp_eng', me, 'Shane Ansel', 'Nice. What is left on Sheets?', 36],
    ['sp_eng', 'dana@example.com', 'Dana Reyes', 'Frozen panes and conditional formatting.', 34],
    ['sp_eng', 'miguel@example.com', 'Miguel Ortiz', 'I can take conditional formatting after presenter view.', 30],
    ['sp_launch', me, 'Shane Ansel', 'Sixteen apps. App switcher has to be identical on every one.', 20],
    ['sp_launch', 'priya@example.com', 'Priya Nair', 'Waffle is shared now — one component, all apps.', 18],
    ['sp_dana', 'dana@example.com', 'Dana Reyes', 'Got a minute for the VLOOKUP edge case?', 12],
    ['sp_dana', me, 'Shane Ansel', 'Yes — call me.', 10],
  ];
  for (const [sp, author, name, body, hoursAgo] of chats)
    run('INSERT INTO chat_messages(id,space_id,author,author_name,body,sent_at) VALUES(?,?,?,?,?,?)',
      uid('cm_'), sp, author, name, body, t - hoursAgo * 3600000);

  // Groups
  run(`INSERT INTO groups_tbl(id,email,name,description,members,created) VALUES(?,?,?,?,?,?)`,
    'g_eng', 'engineering@example.com', 'Engineering', 'All engineers',
    JSON.stringify(['dana@example.com', 'miguel@example.com', me]), t);
  run(`INSERT INTO groups_tbl(id,email,name,description,members,created) VALUES(?,?,?,?,?,?)`,
    'g_all', 'everyone@example.com', 'Everyone', 'Company-wide announcements',
    JSON.stringify(users.map(u => u[1])), t);

  audit(me, 'admin', 'seed', 'workspace', 'initial dataset');
}
seed();

// Demo data carries two recurring series so the calendar's expansion path is exercised
// on a fresh database and on one seeded before recurrence existed. Idempotent.
run("UPDATE events SET rrule='FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR' WHERE title='Engineering standup' AND rrule IS NULL");
run("UPDATE events SET rrule='FREQ=WEEKLY' WHERE title='Retro' AND rrule IS NULL");
run("UPDATE events SET rrule='FREQ=DAILY' WHERE title='Lunch' AND rrule IS NULL");
