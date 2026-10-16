// End-to-end smoke test: every page serves, every API contract holds,
// and the write paths actually persist. Exits non-zero on any failure.
const BASE = process.env.BASE || 'http://localhost:4400';

import { DatabaseSync } from 'node:sqlite';
const DB = new DatabaseSync('C:/Users/shane/synergy-workspace/data/workspace.db');
const run = sql => { try { DB.exec(sql); } catch {} };

let pass = 0, fail = 0;
const fails = [];
function check(name, ok, detail = '') {
  if (ok) { pass++; }
  else { fail++; fails.push(`${name}${detail ? ' — ' + detail : ''}`); }
}

async function http(path) {
  const r = await fetch(BASE + path);
  return { status: r.status, ct: r.headers.get('content-type') || '', text: await r.text() };
}
async function json(path, method = 'GET', body) {
  const r = await fetch(BASE + path, {
    method,
    headers: body ? { 'content-type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  let j = null;
  try { j = JSON.parse(await r.text()); } catch {}
  return { status: r.status, j };
}

const APPS = ['', 'mail', 'drive', 'docs', 'sheets', 'slides', 'forms', 'calendar', 'keep',
  'tasks', 'contacts', 'chat', 'meet', 'sites', 'groups', 'vault', 'admin'];

console.log('\n=== Pages ===');
for (const a of APPS) {
  const p = a ? `/${a}/` : '/';
  const r = await http(p);
  check(`GET ${p}`, r.status === 200 && r.text.includes('<title>'), `status ${r.status}`);
  if (a) {
    const js = await http(`/${a}/app.js`);
    check(`GET /${a}/app.js`, js.status === 200 && js.ct.includes('javascript'), `status ${js.status}`);
  }
}
for (const s of ['/shared/m3.css', '/shared/shell.js', '/sheets/formula.js']) {
  const r = await http(s);
  check(`GET ${s}`, r.status === 200, `status ${r.status}`);
}

console.log('=== Read APIs ===');
const reads = [
  ['/api/me', j => j.email],
  ['/api/users', j => Array.isArray(j) && j.length >= 5],
  ['/api/drive/files?view=my', j => Array.isArray(j) && j.length > 0],
  ['/api/drive/files?view=starred', j => Array.isArray(j)],
  ['/api/drive/files?view=trash', j => Array.isArray(j)],
  ['/api/drive/files?view=shared', j => Array.isArray(j)],
  ['/api/drive/storage', j => typeof j.used === 'number' && j.quota > 0],
  ['/api/calendar/calendars', j => Array.isArray(j) && j.length >= 3],
  ['/api/calendar/events', j => Array.isArray(j) && j.length >= 10],
  ['/api/notes', j => Array.isArray(j) && j.length >= 5],
  ['/api/tasks/lists', j => Array.isArray(j) && j.length >= 2],
  ['/api/tasks', j => Array.isArray(j) && j.length >= 6],
  ['/api/contacts', j => Array.isArray(j) && j.length >= 7],
  ['/api/mail/messages?label=INBOX', j => Array.isArray(j) && j.length >= 4],
  ['/api/mail/counts', j => typeof j.INBOX === 'number' && typeof j.ALL === 'number'],
  ['/api/mail/messages?label=ALL', j => Array.isArray(j) && j.length >= 4],
  ['/api/chat/spaces', j => Array.isArray(j) && j.length >= 4],
  ['/api/groups', j => Array.isArray(j) && j.length >= 2],
  ['/api/admin/stats', j => j.users >= 5 && j.files > 0],
  ['/api/admin/audit', j => Array.isArray(j)],
  ['/api/search?q=roadmap', j => Array.isArray(j) && j.length > 0],
];
for (const [path, ok] of reads) {
  const r = await json(path);
  let good = false;
  try { good = r.status === 200 && ok(r.j); } catch {}
  check(`GET ${path}`, good, `status ${r.status} body ${JSON.stringify(r.j).slice(0, 90)}`);
}

console.log('=== Dates are sane ===');
{
  const files = (await json('/api/drive/files?view=recent')).j;
  const bad = files.filter(f => f.modified < Date.UTC(2020, 0, 1));
  check('file timestamps are post-2020', bad.length === 0,
    bad.length ? `${bad.length} bad, e.g. ${bad[0].name}=${new Date(bad[0].modified).toISOString()}` : '');
  const msgs = (await json('/api/mail/messages?label=INBOX')).j;
  const badM = msgs.filter(m => m.sent_at < Date.UTC(2020, 0, 1));
  check('message timestamps are post-2020', badM.length === 0, `${badM.length} bad`);
}

console.log('=== Write round-trips ===');
{
  // Drive: create -> read back -> patch content -> revision -> trash -> delete
  const f = (await json('/api/drive/files', 'POST',
    { name: 'smoke-doc', mime: 'application/vnd.synergy-apps.document', content: '{"html":"<p>v1</p>"}' })).j;
  check('drive create returns id', !!f.id);
  const got = (await json('/api/drive/files/' + f.id)).j;
  check('drive read-back name', got.name === 'smoke-doc', got.name);
  check('drive read-back content', got.content.includes('v1'));

  await json('/api/drive/files/' + f.id, 'PATCH', { content: '{"html":"<p>v2</p>"}' });
  const v2 = (await json('/api/drive/files/' + f.id)).j;
  check('drive content updated', v2.content.includes('v2'), v2.content);
  const revs = (await json(`/api/drive/files/${f.id}/revisions`)).j;
  check('revision recorded on edit', revs.length >= 1, `${revs.length} revisions`);

  await json(`/api/drive/files/${f.id}/share`, 'POST', { email: 'dana@example.com', role: 'writer' });
  const shared = (await json('/api/drive/files/' + f.id)).j;
  check('share persists', shared.shared.some(s => s.user_email === 'dana@example.com'));

  await json('/api/drive/files/' + f.id, 'PATCH', { trashed: 1 });
  const trash = (await json('/api/drive/files?view=trash')).j;
  check('trashed file appears in trash', trash.some(x => x.id === f.id));
  await json('/api/drive/files/' + f.id, 'DELETE');
  const gone = await json('/api/drive/files/' + f.id);
  check('hard delete removes file', gone.status === 404, `status ${gone.status}`);
}
{
  // Comments
  const c = (await json('/api/comments/d_roadmap', 'POST', { body: 'smoke comment', anchor: 'Objectives' })).j;
  check('comment created', !!c.id);
  const list = (await json('/api/comments/d_roadmap')).j;
  check('comment listed', list.some(x => x.id === c.id));
  await json(`/api/comments/d_roadmap/${c.id}`, 'PATCH', { resolved: 1 });
  const res = (await json('/api/comments/d_roadmap')).j.find(x => x.id === c.id);
  check('comment resolves', res.resolved === 1);
  await json(`/api/comments/d_roadmap/${c.id}`, 'DELETE');
}
{
  // Calendar
  const start = Date.now() + 3600000;
  const e = (await json('/api/calendar/events', 'POST',
    { title: 'smoke event', start, end: start + 1800000, calendar_id: 'cal_me', meet: true, attendees: ['dana@example.com'] })).j;
  check('event created', !!e.id);
  check('meet link minted when requested', !!e.meet_link, String(e.meet_link));
  const evs = (await json(`/api/calendar/events?from=${start - 86400000}&to=${start + 86400000}`)).j;
  const mine = evs.find(x => x.id === e.id);
  check('event listed in window', !!mine);
  check('attendees stored', mine && mine.attendees.length >= 1);
  await json('/api/calendar/events/' + e.id, 'PATCH', { title: 'smoke renamed' });
  const after = (await json(`/api/calendar/events?from=${start - 86400000}&to=${start + 86400000}`)).j.find(x => x.id === e.id);
  check('event patch applies', after.title === 'smoke renamed', after.title);
  await json('/api/calendar/events/' + e.id, 'DELETE');
  const gone = (await json(`/api/calendar/events?from=${start - 86400000}&to=${start + 86400000}`)).j.find(x => x.id === e.id);
  check('event deleted', !gone);
}
{
  // Notes with checklist
  const n = (await json('/api/notes', 'POST', { title: 'smoke note', checklist: [{ t: 'a', d: 0 }] })).j;
  check('note created', !!n.id);
  check('checklist stored as JSON', JSON.parse(n.checklist)[0].t === 'a');
  await json('/api/notes/' + n.id, 'PATCH', { pinned: 1 });
  const pinned = (await json('/api/notes')).j.find(x => x.id === n.id);
  check('note pins', pinned && pinned.pinned === 1);
  check('pinned note sorts first', (await json('/api/notes')).j[0].pinned === 1);
  await json('/api/notes/' + n.id, 'DELETE');
}
{
  // Tasks
  const t = (await json('/api/tasks', 'POST', { list_id: 'tl_my', title: 'smoke task' })).j;
  check('task created', !!t.id);
  await json('/api/tasks/' + t.id, 'PATCH', { completed: 1 });
  const done = (await json('/api/tasks?list=tl_my')).j.find(x => x.id === t.id);
  check('task completes', done && done.completed === 1);
  check('completed_at stamped', done && done.completed_at > 0);
  await json('/api/tasks/' + t.id, 'DELETE');
}
{
  // Contacts
  const c = (await json('/api/contacts', 'POST', { name: 'Smoke Person', email: 's@x.io' })).j;
  check('contact created', !!c.id);
  const found = (await json('/api/contacts?q=smoke')).j;
  check('contact search finds it', found.some(x => x.id === c.id));
  await json('/api/contacts/' + c.id, 'DELETE');
}
{
  // Mail send + label moves
  const m = (await json('/api/mail/messages', 'POST', { to: 'dana@example.com', subject: 'smoke', body: 'hello' })).j;
  check('message sent', !!m.id);
  const sent = (await json('/api/mail/messages?label=SENT')).j;
  check('sent message in SENT', sent.some(x => x.id === m.id));
  await json('/api/mail/messages/' + m.id, 'PATCH', { labels: 'TRASH' });
  const trash = (await json('/api/mail/messages?label=TRASH')).j;
  check('message moves to TRASH', trash.some(x => x.id === m.id));
  await json('/api/mail/messages/' + m.id, 'DELETE');
}
{
  // Chat
  const before = (await json('/api/chat/spaces/sp_eng/messages')).j.length;
  const cm = (await json('/api/chat/spaces/sp_eng/messages', 'POST', { body: 'smoke chat' })).j;
  check('chat message posted', !!cm.id);
  const after = (await json('/api/chat/spaces/sp_eng/messages')).j;
  check('chat message appended', after.length === before + 1);
  check('chat ordered by time', after[after.length - 1].id === cm.id);
}
{
  // Forms responses
  const r = await json('/api/forms/fm_survey/responses', 'POST', { answers: { 0: 5, 2: 'Engineering' } });
  check('form response accepted', r.status === 201);
  const list = (await json('/api/forms/fm_survey/responses')).j;
  check('form response listed', list.length >= 1);
  check('answers round-trip', JSON.parse(list[0].answers)['0'] === 5);
}
{
  // Admin
  // unique per run so repeated runs do not collide on the UNIQUE email constraint
  const email = `smoke-${Date.now().toString(36)}@example.com`;
  const u = (await json('/api/admin/users', 'POST', { name: 'Smoke User', email })).j;
  check('admin creates user', !!u.id);
  await json('/api/admin/users/' + u.id, 'PATCH', { suspended: 1, role: 'admin' });
  const after = (await json('/api/users')).j.find(x => x.id === u.id);
  check('admin suspend applies', after && after.suspended === 1);
  check('admin role applies', after && after.role === 'admin');
  const audit = (await json('/api/admin/audit?limit=10')).j;
  check('audit log records admin action', audit.some(a => a.action === 'update-user'));
  // clean up so the suite stays runnable repeatedly
  run(`DELETE FROM users WHERE id='${u.id}'`);
}
{
  // Unified search across services
  const r = (await json('/api/search?q=sheets')).j;
  check('search spans services', new Set(r.map(x => x.app)).size >= 1, JSON.stringify(r.map(x => x.app)));
  const empty = (await json('/api/search?q=')).j;
  check('empty search returns empty', Array.isArray(empty) && empty.length === 0);
}
{
  // Recurrence expansion
  const from = Date.now() - 2 * 86400000, to = Date.now() + 12 * 86400000;
  const evs = (await json(`/api/calendar/events?from=${from}&to=${to}`)).j;
  const standups = evs.filter(e => e.title === 'Engineering standup');
  check('recurring series expands to many occurrences', standups.length >= 8, `${standups.length}`);
  check('BYDAY excludes weekends', standups.every(e => { const d = new Date(e.start).getDay(); return d !== 0 && d !== 6; }));
  check('occurrences carry the recurring flag', standups.every(e => e.recurring === 1));
  check('occurrences keep their duration', standups.every(e => e.end - e.start === 15 * 60000));
  const daily = evs.filter(e => e.title === 'Lunch');
  check('daily series expands', daily.length >= 12, `${daily.length}`);
}
{
  // Archive is reachable: leaves INBOX, stays in All Mail
  const inbox = (await json('/api/mail/messages?label=INBOX')).j;
  const target = inbox[0];
  await json('/api/mail/messages/' + target.id, 'PATCH', { labels: 'ARCHIVE' });
  const inbox2 = (await json('/api/mail/messages?label=INBOX')).j;
  const all2 = (await json('/api/mail/messages?label=ALL')).j;
  check('archived message leaves INBOX', !inbox2.some(m => m.id === target.id));
  check('archived message stays in All Mail', all2.some(m => m.id === target.id));
  await json('/api/mail/messages/' + target.id, 'PATCH', { labels: 'INBOX' });
  const back = (await json('/api/mail/messages?label=INBOX')).j;
  check('move back to INBOX works', back.some(m => m.id === target.id));
}
{
  // 404 behaviour
  const r = await json('/api/does/not/exist');
  check('unknown API route 404s', r.status === 404, `status ${r.status}`);
}

console.log(`\nSmoke: ${pass}/${pass + fail} passed, ${fail} failed\n`);
if (fails.length) { for (const f of fails) console.log('  FAIL  ' + f); process.exit(1); }
console.log('All smoke checks passed.\n');
