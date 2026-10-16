// Synergy Workspace — HTTP server. No framework, no npm deps.
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { join, extname, normalize, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { all, get, run, uid, now, audit, MIME, db } from './db.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const WEB = join(ROOT, 'web');
const PORT = process.env.PORT || 4400;
const ME = 'shane@example.com';

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png',
  '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.map': 'application/json',
};

const json = (res, data, code = 200) => {
  const b = JSON.stringify(data);
  res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'content-length': Buffer.byteLength(b) });
  res.end(b);
};
const bad = (res, msg, code = 400) => json(res, { error: msg }, code);

async function body(req) {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  if (!chunks.length) return {};
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { return {}; }
}

// ------------------------------------------------------------------ routes
const routes = [];
const route = (method, pattern, handler) => {
  const keys = [];
  const rx = new RegExp('^' + pattern.replace(/:([a-zA-Z]+)/g, (_, k) => { keys.push(k); return '([^/]+)'; }) + '$');
  routes.push({ method, rx, keys, handler });
};

// ---- identity ----
route('GET', '/api/me', (q, p, res) => {
  const u = get('SELECT * FROM users WHERE email=?', ME);
  json(res, u);
});
route('GET', '/api/users', (q, p, res) =>
  json(res, all('SELECT id,email,name,avatar_color,role,suspended,org_unit FROM users ORDER BY name')));

// ---- Drive ----
route('GET', '/api/drive/files', (q, p, res) => {
  const view = q.view || 'my';
  let sql = 'SELECT * FROM files WHERE trashed=0', args = [];
  if (view === 'trash') { sql = 'SELECT * FROM files WHERE trashed=1'; }
  else if (view === 'starred') { sql += ' AND starred=1'; }
  else if (view === 'shared') {
    sql = `SELECT f.* FROM files f JOIN permissions pm ON pm.file_id=f.id
           WHERE f.trashed=0 AND pm.user_email!=? GROUP BY f.id`; args = [ME];
  } else if (view === 'recent') { sql += ' AND mime!=?'; args = [MIME.folder]; }
  else if (q.parent) { sql += ' AND parent IS ?'; args = [q.parent === 'root' ? null : q.parent]; }
  else if (view === 'my') { sql += ' AND parent IS NULL'; }
  if (q.mime) { sql += ' AND mime=?'; args.push(q.mime); }
  if (q.q) { sql += ' AND lower(name) LIKE ?'; args.push('%' + q.q.toLowerCase() + '%'); }
  const order = view === 'recent' ? ' ORDER BY modified DESC LIMIT 40'
    : ` ORDER BY (mime='${MIME.folder}') DESC, ${q.sort === 'name' ? 'name COLLATE NOCASE' : 'modified DESC'}`;
  const rows = all(sql + order, ...args);
  for (const r of rows) {
    r.shared = all('SELECT user_email,role FROM permissions WHERE file_id=?', r.id);
    delete r.content;
  }
  json(res, rows);
});

route('GET', '/api/drive/breadcrumb/:id', (q, p, res) => {
  const crumbs = []; let cur = p.id === 'root' ? null : get('SELECT * FROM files WHERE id=?', p.id);
  while (cur) { crumbs.unshift({ id: cur.id, name: cur.name }); cur = cur.parent ? get('SELECT * FROM files WHERE id=?', cur.parent) : null; }
  json(res, crumbs);
});

route('POST', '/api/drive/files', async (q, p, res, req) => {
  const b = await body(req);
  const id = uid(b.mime === MIME.folder ? 'fo_' : 'fl_');
  const content = b.content !== undefined ? (typeof b.content === 'string' ? b.content : JSON.stringify(b.content)) : null;
  run(`INSERT INTO files(id,name,mime,parent,owner,content,size,created,modified,modified_by)
       VALUES(?,?,?,?,?,?,?,?,?,?)`,
    id, b.name || 'Untitled', b.mime || MIME.doc, b.parent || null, ME, content,
    (content || '').length, now(), now(), ME);
  audit(ME, 'drive', 'create', id, b.name || '');
  json(res, get('SELECT * FROM files WHERE id=?', id), 201);
});

route('GET', '/api/drive/files/:id', (q, p, res) => {
  const f = get('SELECT * FROM files WHERE id=?', p.id);
  if (!f) return bad(res, 'not found', 404);
  f.shared = all('SELECT user_email,role FROM permissions WHERE file_id=?', p.id);
  json(res, f);
});

route('PATCH', '/api/drive/files/:id', async (q, p, res, req) => {
  const b = await body(req);
  const f = get('SELECT * FROM files WHERE id=?', p.id);
  if (!f) return bad(res, 'not found', 404);
  const fields = ['name', 'parent', 'starred', 'trashed', 'shared_mode', 'thumb'];
  for (const k of fields)
    if (b[k] !== undefined) run(`UPDATE files SET ${k}=? WHERE id=?`, b[k], p.id);
  if (b.content !== undefined) {
    const c = typeof b.content === 'string' ? b.content : JSON.stringify(b.content);
    run('INSERT INTO revisions(file_id,content,author,created) VALUES(?,?,?,?)', p.id, f.content, ME, now());
    run('UPDATE files SET content=?, size=? WHERE id=?', c, c.length, p.id);
  }
  run('UPDATE files SET modified=?, modified_by=? WHERE id=?', now(), ME, p.id);
  audit(ME, 'drive', 'update', p.id, Object.keys(b).join(','));
  json(res, get('SELECT * FROM files WHERE id=?', p.id));
});

route('DELETE', '/api/drive/files/:id', (q, p, res) => {
  run('DELETE FROM files WHERE id=?', p.id);
  audit(ME, 'drive', 'delete', p.id, '');
  json(res, { ok: true });
});

route('POST', '/api/drive/files/:id/share', async (q, p, res, req) => {
  const b = await body(req);
  run('INSERT OR REPLACE INTO permissions(file_id,user_email,role,created) VALUES(?,?,?,?)',
    p.id, b.email, b.role || 'reader', now());
  audit(ME, 'drive', 'share', p.id, b.email);
  json(res, all('SELECT user_email,role FROM permissions WHERE file_id=?', p.id));
});
route('DELETE', '/api/drive/files/:id/share/:email', (q, p, res) => {
  run('DELETE FROM permissions WHERE file_id=? AND user_email=?', p.id, decodeURIComponent(p.email));
  json(res, { ok: true });
});

route('GET', '/api/drive/storage', (q, p, res) => {
  const r = get('SELECT COALESCE(SUM(size),0) used, COUNT(*) n FROM files WHERE trashed=0');
  json(res, { used: r.used, count: r.n, quota: 30 * 1024 ** 3 });
});

route('GET', '/api/drive/files/:id/revisions', (q, p, res) =>
  json(res, all('SELECT id,author,created,label FROM revisions WHERE file_id=? ORDER BY created DESC LIMIT 50', p.id)));

// ---- comments (shared by docs/sheets/slides) ----
route('GET', '/api/comments/:fileId', (q, p, res) =>
  json(res, all('SELECT * FROM comments WHERE file_id=? ORDER BY created', p.fileId)));
route('POST', '/api/comments/:fileId', async (q, p, res, req) => {
  const b = await body(req); const id = uid('cm_');
  run('INSERT INTO comments(id,file_id,anchor,author,body,parent_id,created) VALUES(?,?,?,?,?,?,?)',
    id, p.fileId, b.anchor || '', ME, b.body, b.parent_id || null, now());
  json(res, get('SELECT * FROM comments WHERE id=?', id), 201);
});
route('PATCH', '/api/comments/:fileId/:id', async (q, p, res, req) => {
  const b = await body(req);
  if (b.resolved !== undefined) run('UPDATE comments SET resolved=? WHERE id=?', b.resolved, p.id);
  if (b.body !== undefined) run('UPDATE comments SET body=? WHERE id=?', b.body, p.id);
  json(res, get('SELECT * FROM comments WHERE id=?', p.id));
});
route('DELETE', '/api/comments/:fileId/:id', (q, p, res) => {
  run('DELETE FROM comments WHERE id=? OR parent_id=?', p.id, p.id); json(res, { ok: true });
});

// ---- Calendar ----
route('GET', '/api/calendar/calendars', (q, p, res) =>
  json(res, all('SELECT * FROM calendars WHERE owner=? ORDER BY primary_cal DESC, name', ME)));
route('PATCH', '/api/calendar/calendars/:id', async (q, p, res, req) => {
  const b = await body(req);
  for (const k of ['visible', 'color', 'name']) if (b[k] !== undefined) run(`UPDATE calendars SET ${k}=? WHERE id=?`, b[k], p.id);
  json(res, get('SELECT * FROM calendars WHERE id=?', p.id));
});
// Expand an RRULE into the concrete occurrences that fall inside [from,to].
// Supports FREQ=DAILY|WEEKLY|MONTHLY|YEARLY with INTERVAL, COUNT, UNTIL and BYDAY.
const DAY_MS = 86400000;
const BYDAY_MAP = { SU: 0, MO: 1, TU: 2, WE: 3, TH: 4, FR: 5, SA: 6 };

function expandRecurrence(ev, from, to) {
  if (!ev.rrule) return [ev];
  const parts = Object.fromEntries(ev.rrule.split(';').map(kv => {
    const [k, v] = kv.split('=');
    return [k.toUpperCase(), v];
  }));
  const freq = (parts.FREQ || '').toUpperCase();
  if (!freq) return [ev];
  const interval = Math.max(1, parseInt(parts.INTERVAL || '1', 10));
  const count = parts.COUNT ? parseInt(parts.COUNT, 10) : Infinity;
  const until = parts.UNTIL ? Number(parts.UNTIL) : Infinity;
  const byday = parts.BYDAY
    ? parts.BYDAY.split(',').map(d => BYDAY_MAP[d.trim().toUpperCase()]).filter(d => d !== undefined)
    : null;

  const duration = ev.end - ev.start;
  const out = [];
  let emitted = 0;
  // Walk from the series start; cap the loop so a malformed rule cannot hang the server.
  const cursor = new Date(ev.start);
  for (let step = 0; step < 2000 && emitted < count; step++) {
    let occStart;
    if (freq === 'DAILY') occStart = ev.start + step * interval * DAY_MS;
    else if (freq === 'WEEKLY') {
      if (byday && byday.length) {
        // Each step is one week; emit every selected weekday in that week.
        const weekStart = new Date(ev.start);
        weekStart.setDate(weekStart.getDate() - weekStart.getDay() + step * interval * 7);
        for (const d of byday) {
          const occ = new Date(weekStart);
          occ.setDate(weekStart.getDate() + d);
          const t = occ.getTime();
          if (t < ev.start || t > until) continue;
          if (t < to && t + duration > from) out.push({ ...ev, start: t, end: t + duration, recurring: 1 });
          emitted++;
          if (emitted >= count) break;
        }
        if (weekStart.getTime() > to) break;
        continue;
      }
      occStart = ev.start + step * interval * 7 * DAY_MS;
    } else if (freq === 'MONTHLY') {
      const d = new Date(ev.start);
      d.setMonth(d.getMonth() + step * interval);
      occStart = d.getTime();
    } else if (freq === 'YEARLY') {
      const d = new Date(ev.start);
      d.setFullYear(d.getFullYear() + step * interval);
      occStart = d.getTime();
    } else return [ev];

    if (occStart > until) break;
    if (occStart > to) break;
    emitted++;
    if (occStart < to && occStart + duration > from)
      out.push({ ...ev, start: occStart, end: occStart + duration, recurring: 1 });
  }
  return out;
}

route('GET', '/api/calendar/events', (q, p, res) => {
  const to = Number(q.to || now() + 30 * 86400000);
  const from = Number(q.from || now() - 30 * 86400000);
  // Non-recurring events are filtered by the window in SQL; recurring series must be
  // fetched regardless of where their first occurrence sits and expanded in memory.
  const rows = all(`SELECT e.*, c.color cal_color, c.name cal_name, c.visible
                    FROM events e JOIN calendars c ON c.id=e.calendar_id
                    WHERE (e.rrule IS NOT NULL AND e.start <= ?)
                       OR (e.rrule IS NULL AND e.start < ? AND e.end > ?)
                    ORDER BY e.start`, to, to, from);
  const out = [];
  for (const r of rows) {
    r.attendees = all('SELECT email,response,optional FROM attendees WHERE event_id=?', r.id);
    for (const occ of expandRecurrence(r, from, to)) out.push(occ);
  }
  out.sort((a, b) => a.start - b.start);
  json(res, out);
});
route('POST', '/api/calendar/events', async (q, p, res, req) => {
  const b = await body(req); const id = uid('ev_');
  run(`INSERT INTO events(id,calendar_id,title,description,location,start,end,all_day,rrule,meet_link,organizer,created)
       VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`,
    id, b.calendar_id || 'cal_me', b.title || '(No title)', b.description || '', b.location || '',
    b.start, b.end, b.all_day ? 1 : 0, b.rrule || null,
    b.meet ? 'meet.example.com/' + uid().slice(0, 10) : null, ME, now());
  for (const e of (b.attendees || []))
    run('INSERT INTO attendees(event_id,email,response) VALUES(?,?,?)', id, e, 'needsAction');
  audit(ME, 'calendar', 'create', id, b.title || '');
  json(res, get('SELECT * FROM events WHERE id=?', id), 201);
});
route('PATCH', '/api/calendar/events/:id', async (q, p, res, req) => {
  const b = await body(req);
  for (const k of ['title', 'description', 'location', 'start', 'end', 'all_day', 'calendar_id'])
    if (b[k] !== undefined) run(`UPDATE events SET ${k}=? WHERE id=?`, b[k], p.id);
  json(res, get('SELECT * FROM events WHERE id=?', p.id));
});
route('DELETE', '/api/calendar/events/:id', (q, p, res) => {
  run('DELETE FROM attendees WHERE event_id=?', p.id);
  run('DELETE FROM events WHERE id=?', p.id); json(res, { ok: true });
});

// ---- Keep ----
route('GET', '/api/notes', (q, p, res) => {
  const v = q.view || 'active';
  const where = v === 'archive' ? 'archived=1 AND trashed=0'
    : v === 'trash' ? 'trashed=1' : 'archived=0 AND trashed=0';
  let sql = `SELECT * FROM notes WHERE owner=? AND ${where}`, args = [ME];
  if (q.q) { sql += ' AND (lower(title) LIKE ? OR lower(body) LIKE ?)'; args.push('%' + q.q.toLowerCase() + '%', '%' + q.q.toLowerCase() + '%'); }
  json(res, all(sql + ' ORDER BY pinned DESC, modified DESC', ...args));
});
route('POST', '/api/notes', async (q, p, res, req) => {
  const b = await body(req); const id = uid('n_');
  run(`INSERT INTO notes(id,owner,title,body,color,pinned,checklist,labels,created,modified)
       VALUES(?,?,?,?,?,?,?,?,?,?)`, id, ME, b.title || '', b.body || '', b.color || 'default',
    b.pinned ? 1 : 0, b.checklist ? JSON.stringify(b.checklist) : null, b.labels || null, now(), now());
  json(res, get('SELECT * FROM notes WHERE id=?', id), 201);
});
route('PATCH', '/api/notes/:id', async (q, p, res, req) => {
  const b = await body(req);
  for (const k of ['title', 'body', 'color', 'pinned', 'archived', 'trashed', 'labels'])
    if (b[k] !== undefined) run(`UPDATE notes SET ${k}=? WHERE id=?`, b[k], p.id);
  if (b.checklist !== undefined)
    run('UPDATE notes SET checklist=? WHERE id=?', b.checklist ? JSON.stringify(b.checklist) : null, p.id);
  run('UPDATE notes SET modified=? WHERE id=?', now(), p.id);
  json(res, get('SELECT * FROM notes WHERE id=?', p.id));
});
route('DELETE', '/api/notes/:id', (q, p, res) => { run('DELETE FROM notes WHERE id=?', p.id); json(res, { ok: true }); });

// ---- Tasks ----
route('GET', '/api/tasks/lists', (q, p, res) =>
  json(res, all('SELECT * FROM task_lists WHERE owner=? ORDER BY position', ME)));
route('POST', '/api/tasks/lists', async (q, p, res, req) => {
  const b = await body(req); const id = uid('tl_');
  run('INSERT INTO task_lists(id,owner,name,position) VALUES(?,?,?,?)', id, ME, b.name || 'New list',
    get('SELECT COUNT(*) c FROM task_lists WHERE owner=?', ME).c);
  json(res, get('SELECT * FROM task_lists WHERE id=?', id), 201);
});
route('DELETE', '/api/tasks/lists/:id', (q, p, res) => {
  run('DELETE FROM tasks WHERE list_id=?', p.id); run('DELETE FROM task_lists WHERE id=?', p.id); json(res, { ok: true });
});
route('GET', '/api/tasks', (q, p, res) => {
  let sql = `SELECT t.* FROM tasks t JOIN task_lists l ON l.id=t.list_id WHERE l.owner=?`, args = [ME];
  if (q.list) { sql += ' AND t.list_id=?'; args.push(q.list); }
  json(res, all(sql + ' ORDER BY t.completed, t.position, t.created', ...args));
});
route('POST', '/api/tasks', async (q, p, res, req) => {
  const b = await body(req); const id = uid('tk_');
  run(`INSERT INTO tasks(id,list_id,title,notes,due,parent_id,position,created) VALUES(?,?,?,?,?,?,?,?)`,
    id, b.list_id, b.title || '', b.notes || '', b.due || null, b.parent_id || null,
    get('SELECT COUNT(*) c FROM tasks WHERE list_id=?', b.list_id).c, now());
  json(res, get('SELECT * FROM tasks WHERE id=?', id), 201);
});
route('PATCH', '/api/tasks/:id', async (q, p, res, req) => {
  const b = await body(req);
  for (const k of ['title', 'notes', 'due', 'completed', 'starred', 'list_id', 'position'])
    if (b[k] !== undefined) run(`UPDATE tasks SET ${k}=? WHERE id=?`, b[k], p.id);
  if (b.completed !== undefined) run('UPDATE tasks SET completed_at=? WHERE id=?', b.completed ? now() : null, p.id);
  json(res, get('SELECT * FROM tasks WHERE id=?', p.id));
});
route('DELETE', '/api/tasks/:id', (q, p, res) => { run('DELETE FROM tasks WHERE id=?', p.id); json(res, { ok: true }); });

// ---- Contacts ----
route('GET', '/api/contacts', (q, p, res) => {
  let sql = 'SELECT * FROM contacts WHERE owner=?', args = [ME];
  if (q.view === 'starred') sql += ' AND starred=1';
  if (q.q) { sql += ' AND (lower(name) LIKE ? OR lower(email) LIKE ? OR lower(company) LIKE ?)'; const s = '%' + q.q.toLowerCase() + '%'; args.push(s, s, s); }
  json(res, all(sql + ' ORDER BY name COLLATE NOCASE', ...args));
});
route('POST', '/api/contacts', async (q, p, res, req) => {
  const b = await body(req); const id = uid('c_');
  run(`INSERT INTO contacts(id,owner,name,email,phone,company,job_title,notes,starred,photo_color,created,modified)
       VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`, id, ME, b.name || '', b.email || '', b.phone || '',
    b.company || '', b.job_title || '', b.notes || '', b.starred ? 1 : 0,
    b.photo_color || '#0b57d0', now(), now());
  json(res, get('SELECT * FROM contacts WHERE id=?', id), 201);
});
route('PATCH', '/api/contacts/:id', async (q, p, res, req) => {
  const b = await body(req);
  for (const k of ['name', 'email', 'phone', 'company', 'job_title', 'notes', 'starred'])
    if (b[k] !== undefined) run(`UPDATE contacts SET ${k}=? WHERE id=?`, b[k], p.id);
  run('UPDATE contacts SET modified=? WHERE id=?', now(), p.id);
  json(res, get('SELECT * FROM contacts WHERE id=?', p.id));
});
route('DELETE', '/api/contacts/:id', (q, p, res) => { run('DELETE FROM contacts WHERE id=?', p.id); json(res, { ok: true }); });

// ---- Mail ----
route('GET', '/api/mail/messages', (q, p, res) => {
  const label = (q.label || 'INBOX').toUpperCase();
  let sql = 'SELECT * FROM messages WHERE owner=?', args = [ME];
  if (label === 'STARRED') sql += " AND starred=1 AND labels NOT IN ('TRASH','SPAM')";
  else if (label === 'UNREAD') sql += ' AND unread=1';
  // "All Mail" is everything still in the mailbox — inbox, archived and sent — but not
  // spam, trash or drafts, which is how Gmail scopes it.
  else if (label === 'ALL') sql += " AND labels NOT IN ('TRASH','SPAM','DRAFTS')";
  else { sql += ' AND labels=?'; args.push(label); }
  if (q.q) { sql += ' AND (lower(subject) LIKE ? OR lower(body) LIKE ? OR lower(sender_name) LIKE ?)'; const s = '%' + q.q.toLowerCase() + '%'; args.push(s, s, s); }
  json(res, all(sql + ' ORDER BY sent_at DESC', ...args));
});
route('GET', '/api/mail/counts', (q, p, res) => {
  json(res, {
    INBOX: get("SELECT COUNT(*) c FROM messages WHERE owner=? AND labels='INBOX' AND unread=1", ME).c,
    SNOOZED: get("SELECT COUNT(*) c FROM messages WHERE owner=? AND labels='SNOOZED'", ME).c,
    ALL: get("SELECT COUNT(*) c FROM messages WHERE owner=? AND labels NOT IN ('TRASH','SPAM','DRAFTS') AND unread=1", ME).c,
    STARRED: get('SELECT COUNT(*) c FROM messages WHERE owner=? AND starred=1', ME).c,
    DRAFTS: get("SELECT COUNT(*) c FROM messages WHERE owner=? AND labels='DRAFTS'", ME).c,
    SENT: get("SELECT COUNT(*) c FROM messages WHERE owner=? AND labels='SENT'", ME).c,
    SPAM: get("SELECT COUNT(*) c FROM messages WHERE owner=? AND labels='SPAM'", ME).c,
    TRASH: get("SELECT COUNT(*) c FROM messages WHERE owner=? AND labels='TRASH'", ME).c,
  });
});
route('POST', '/api/mail/messages', async (q, p, res, req) => {
  const b = await body(req); const id = uid('m_');
  run(`INSERT INTO messages(id,thread_id,owner,sender,sender_name,recipients,cc,subject,body,snippet,
       labels,unread,sent_at,draft) VALUES(?,?,?,?,?,?,?,?,?,?,?,0,?,?)`,
    id, b.thread_id || id, ME, ME, 'Shane Ansel', b.to || '', b.cc || '',
    b.subject || '(no subject)', b.body || '', (b.body || '').slice(0, 120),
    b.draft ? 'DRAFTS' : 'SENT', now(), b.draft ? 1 : 0);
  audit(ME, 'mail', b.draft ? 'draft' : 'send', id, b.subject || '');
  json(res, get('SELECT * FROM messages WHERE id=?', id), 201);
});
route('PATCH', '/api/mail/messages/:id', async (q, p, res, req) => {
  const b = await body(req);
  for (const k of ['unread', 'starred', 'important', 'labels'])
    if (b[k] !== undefined) run(`UPDATE messages SET ${k}=? WHERE id=?`, b[k], p.id);
  json(res, get('SELECT * FROM messages WHERE id=?', p.id));
});
route('DELETE', '/api/mail/messages/:id', (q, p, res) => { run('DELETE FROM messages WHERE id=?', p.id); json(res, { ok: true }); });

// ---- Chat ----
route('GET', '/api/chat/spaces', (q, p, res) =>
  json(res, all('SELECT * FROM spaces ORDER BY type, name')));
route('GET', '/api/chat/spaces/:id/messages', (q, p, res) =>
  json(res, all('SELECT * FROM chat_messages WHERE space_id=? ORDER BY sent_at', p.id)));
route('POST', '/api/chat/spaces/:id/messages', async (q, p, res, req) => {
  const b = await body(req); const id = uid('cm_');
  run('INSERT INTO chat_messages(id,space_id,author,author_name,body,sent_at) VALUES(?,?,?,?,?,?)',
    id, p.id, ME, 'Shane Ansel', b.body, now());
  run('UPDATE spaces SET last_activity=? WHERE id=?', now(), p.id);
  json(res, get('SELECT * FROM chat_messages WHERE id=?', id), 201);
});
route('POST', '/api/chat/spaces', async (q, p, res, req) => {
  const b = await body(req); const id = uid('sp_');
  run('INSERT INTO spaces(id,name,type,members,created,last_activity) VALUES(?,?,?,?,?,?)',
    id, b.name, b.type || 'room', JSON.stringify(b.members || [ME]), now(), now());
  json(res, get('SELECT * FROM spaces WHERE id=?', id), 201);
});

// ---- Forms ----
route('GET', '/api/forms/:id/responses', (q, p, res) =>
  json(res, all('SELECT * FROM form_responses WHERE form_id=? ORDER BY submitted DESC', p.id)));
route('POST', '/api/forms/:id/responses', async (q, p, res, req) => {
  const b = await body(req); const id = uid('fr_');
  run('INSERT INTO form_responses(id,form_id,respondent,answers,submitted) VALUES(?,?,?,?,?)',
    id, p.id, b.respondent || 'anonymous', JSON.stringify(b.answers || {}), now());
  json(res, { ok: true, id }, 201);
});

// ---- Groups ----
route('GET', '/api/groups', (q, p, res) => json(res, all('SELECT * FROM groups_tbl ORDER BY name')));
route('POST', '/api/groups', async (q, p, res, req) => {
  const b = await body(req); const id = uid('g_');
  run('INSERT INTO groups_tbl(id,email,name,description,members,access,created) VALUES(?,?,?,?,?,?,?)',
    id, b.email, b.name, b.description || '', JSON.stringify(b.members || []), b.access || 'restricted', now());
  json(res, get('SELECT * FROM groups_tbl WHERE id=?', id), 201);
});

// ---- Admin ----
route('GET', '/api/admin/audit', (q, p, res) =>
  json(res, all('SELECT * FROM audit_log ORDER BY at DESC LIMIT ?', Number(q.limit || 100))));
route('GET', '/api/admin/stats', (q, p, res) => json(res, {
  users: get('SELECT COUNT(*) c FROM users').c,
  files: get('SELECT COUNT(*) c FROM files WHERE trashed=0').c,
  storage: get('SELECT COALESCE(SUM(size),0) s FROM files').s,
  events: get('SELECT COUNT(*) c FROM events').c,
  messages: get('SELECT COUNT(*) c FROM messages').c,
  groups: get('SELECT COUNT(*) c FROM groups_tbl').c,
  spaces: get('SELECT COUNT(*) c FROM spaces').c,
}));
route('PATCH', '/api/admin/users/:id', async (q, p, res, req) => {
  const b = await body(req);
  for (const k of ['role', 'suspended', 'org_unit', 'name'])
    if (b[k] !== undefined) run(`UPDATE users SET ${k}=? WHERE id=?`, b[k], p.id);
  audit(ME, 'admin', 'update-user', p.id, JSON.stringify(b));
  json(res, get('SELECT * FROM users WHERE id=?', p.id));
});
route('POST', '/api/admin/users', async (q, p, res, req) => {
  const b = await body(req); const id = uid('u_');
  run('INSERT INTO users(id,email,name,role,org_unit,created) VALUES(?,?,?,?,?,?)',
    id, b.email, b.name, b.role || 'member', b.org_unit || '/', now());
  audit(ME, 'admin', 'create-user', id, b.email);
  json(res, get('SELECT * FROM users WHERE id=?', id), 201);
});

// ---- Meet ----
route('POST', '/api/meet/start', async (q, p, res, req) => {
  const b = await body(req); const id = uid('mt_');
  const code = [0, 1, 2].map(() => Math.random().toString(36).slice(2, 6)).join('-');
  run('INSERT INTO meetings(id,code,title,host,participants,started) VALUES(?,?,?,?,?,?)',
    id, code, b.title || 'Instant meeting', ME, JSON.stringify([ME]), now());
  json(res, get('SELECT * FROM meetings WHERE id=?', id), 201);
});
route('GET', '/api/meet/:code', (q, p, res) => {
  const m = get('SELECT * FROM meetings WHERE code=?', p.code);
  json(res, m || { error: 'not found' }, m ? 200 : 404);
});

// ---- unified search (the suite-wide search box) ----
route('GET', '/api/search', (q, p, res) => {
  const s = '%' + (q.q || '').toLowerCase() + '%';
  if (!q.q) return json(res, []);
  const out = [];
  for (const f of all('SELECT id,name,mime,modified FROM files WHERE trashed=0 AND lower(name) LIKE ? LIMIT 8', s))
    out.push({ app: 'drive', id: f.id, title: f.name, mime: f.mime, at: f.modified });
  for (const m of all('SELECT id,subject,sender_name,sent_at FROM messages WHERE owner=? AND (lower(subject) LIKE ? OR lower(body) LIKE ?) LIMIT 6', ME, s, s))
    out.push({ app: 'mail', id: m.id, title: m.subject, sub: m.sender_name, at: m.sent_at });
  for (const e of all('SELECT id,title,start FROM events WHERE lower(title) LIKE ? LIMIT 5', s))
    out.push({ app: 'calendar', id: e.id, title: e.title, at: e.start });
  for (const n of all('SELECT id,title,body,modified FROM notes WHERE owner=? AND (lower(title) LIKE ? OR lower(body) LIKE ?) LIMIT 5', ME, s, s))
    out.push({ app: 'keep', id: n.id, title: n.title || n.body.slice(0, 40), at: n.modified });
  for (const c of all('SELECT id,name,email FROM contacts WHERE owner=? AND lower(name) LIKE ? LIMIT 5', ME, s))
    out.push({ app: 'contacts', id: c.id, title: c.name, sub: c.email });
  for (const t of all('SELECT t.id,t.title FROM tasks t JOIN task_lists l ON l.id=t.list_id WHERE l.owner=? AND lower(t.title) LIKE ? LIMIT 5', ME, s))
    out.push({ app: 'tasks', id: t.id, title: t.title });
  json(res, out);
});

// ---- dev: let the in-browser harnesses stash artifacts for the review agents ----
route('POST', '/api/_stash/:name', async (q, p, res, req) => {
  const b = await body(req);
  const { writeFile, mkdir } = await import('node:fs/promises');
  const dir = join(ROOT, 'judge', 'artifacts');
  await mkdir(dir, { recursive: true });
  const safe = p.name.replace(/[^a-z0-9._-]/gi, '_');
  await writeFile(join(dir, safe), JSON.stringify(b, null, 1), 'utf8');
  json(res, { ok: true, file: safe });
});

// ------------------------------------------------------------------ static
async function serveStatic(url, res) {
  let rel = decodeURIComponent(url.split('?')[0]);
  if (rel === '/') rel = '/index.html';
  if (rel.endsWith('/')) rel += 'index.html';
  const file = normalize(join(WEB, rel));
  if (!file.startsWith(WEB)) { res.writeHead(403); return res.end('forbidden'); }
  try {
    const st = await stat(file);
    if (st.isDirectory()) return serveStatic(rel + '/index.html', res);
    const buf = await readFile(file);
    res.writeHead(200, {
      'content-type': TYPES[extname(file)] || 'application/octet-stream',
      'content-length': buf.length, 'cache-control': 'no-cache',
    });
    res.end(buf);
  } catch {
    res.writeHead(404, { 'content-type': 'text/html' });
    res.end('<h1>404</h1><p>' + rel + '</p>');
  }
}

createServer(async (req, res) => {
  const [path, qs] = req.url.split('?');
  if (path.startsWith('/api/')) {
    const q = Object.fromEntries(new URLSearchParams(qs || ''));
    for (const r of routes) {
      if (r.method !== req.method) continue;
      const m = path.match(r.rx);
      if (!m) continue;
      const params = Object.fromEntries(r.keys.map((k, i) => [k, m[i + 1]]));
      try { return await r.handler(q, params, res, req); }
      catch (e) { console.error('API error', path, e); return bad(res, e.message, 500); }
    }
    return bad(res, 'no route ' + req.method + ' ' + path, 404);
  }
  serveStatic(req.url, res);
}).listen(PORT, () => {
  console.log(`Synergy Workspace listening on http://localhost:${PORT}`);
  console.log(`  ${get('SELECT COUNT(*) c FROM files').c} files, ` +
    `${get('SELECT COUNT(*) c FROM events').c} events, ` +
    `${get('SELECT COUNT(*) c FROM messages').c} messages seeded`);
});
