/*
 * Brings booking pages over from an older Synergy Hub's Booking by Synergy (Cadence). Reads
 * the export (deploy/hub-import/bookings.sql) as JSON on stdin; deploy/hub-import/run.sh does
 * both steps.
 *
 *   - Each team becomes a booking page at its team address, with its members as staff (team
 *     admins and owners as page admins) and its event types as services. Round-robin and
 *     collective types become "anyone available": customers don't pick a person, and each
 *     service is offered by its hosts.
 *   - Each person with event types of their own gets a page at their user name, with them as
 *     its admin, their weekly availability as its opening hours and their time zone.
 *   - A person's availability becomes their own hours on team pages.
 *   - Event types keep their address, length, buffers, location, price, questions and email
 *     reminders. Notice, booking window and slot interval are per page here: a page takes the
 *     shortest notice, the longest window and the finest interval of its services. Hidden
 *     (secret) and inactive types come across switched off. A daily cap has no equivalent.
 *   - Past and upcoming bookings, calendar connections and webhooks don't come across.
 *
 * Staff are matched to suite accounts by email; --map-email old@example.com=new@example.com
 * puts someone who signs in here with another address on their pages instead.
 *
 * Safe to run again: a page is matched by its address and an admin on it, staff by email and
 * services by address, and whatever is already here is left as it is. --dry-run prints the plan.
 */
import { createDb } from '@synergy/db';

const argv = process.argv.slice(2);
const DRY = argv.includes('--dry-run');
/** --map-email old@x=new@y (repeatable): someone who signs in to the suite with another address. */
const MAP = new Map(argv.flatMap((a, i) => (a === '--map-email' ? [argv[i + 1]] : a.startsWith('--map-email=') ? [a.slice(12)] : []))
  .map((v) => String(v ?? '').toLowerCase().split('=').map((x) => x.trim())).filter(([a, b]) => a && b));
const SLUG = /^[a-z0-9](?:[a-z0-9-]{0,48}[a-z0-9])?$/;

async function readStdin() {
  const chunks = [];
  for await (const c of process.stdin) chunks.push(c);
  const text = Buffer.concat(chunks).toString('utf8').trim();
  if (!text) throw new Error('No hub export on stdin. Run deploy/hub-import/run.sh.');
  return JSON.parse(text);
}

/** "Contoso Hair Salon!" -> "contoso-hair-salon", as the app does. */
function slugify(v) {
  return String(v ?? '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '').slice(0, 50).replace(/-+$/, '');
}
const slugOf = (v, fallback) => (SLUG.test(String(v ?? '')) ? String(v) : slugify(v) || slugify(fallback) || 'bookings');
const text = (v, max) => String(v ?? '').trim().slice(0, max);
const email = (v) => {
  const e = String(v ?? '').trim().toLowerCase();
  return MAP.get(e) ?? e;
};

function isTimeZone(tz) {
  try { new Intl.DateTimeFormat('en-US', { timeZone: tz }); return Boolean(tz); } catch { return false; }
}

const DEFAULT_HOURS = [0, 1, 2, 3, 4, 5, 6].map((d) => (d === 0 || d === 6 ? [] : [[540, 1020]]));

/** Weekly rules (weekday 0 = Sunday) -> seven lists of [start, end) windows, merged and sorted. */
function weekHours(rules) {
  if (!rules?.length) return null;
  const days = [[], [], [], [], [], [], []];
  for (const r of rules) {
    const d = Number(r.weekday), s = Number(r.start_min), e = Number(r.end_min);
    if (d >= 0 && d <= 6 && s >= 0 && e <= 1440 && s < e) days[d].push([s, e]);
  }
  return days.map((ws) => {
    ws.sort((a, b) => a[0] - b[0]);
    const out = [];
    for (const w of ws) {
      const last = out[out.length - 1];
      if (last && w[0] <= last[1]) last[1] = Math.max(last[1], w[1]);
      else out.push([...w]);
    }
    return out.slice(0, 6);
  });
}

function location(t) {
  const kind = String(t.location_type ?? '');
  const value = text(t.location_value, 300);
  if (['video', 'synergymeet', 'meet', ''].includes(kind)) return { kind: 'meet', value: '' };
  if (['phone', 'phone_call'].includes(kind)) return { kind: 'phone', value };
  if (['in_person', 'address', 'inperson'].includes(kind)) return { kind: 'in_person', value };
  return { kind: 'custom', value: value || kind };
}

function price(t) {
  const cents = Number(t.price_cents ?? 0);
  if (!cents) return '';
  const cur = String(t.currency || 'usd').toUpperCase();
  try { return new Intl.NumberFormat('en-US', { style: 'currency', currency: cur }).format(cents / 100); }
  catch { return `${(cents / 100).toFixed(2)} ${cur}`; }
}

function questions(list) {
  return (Array.isArray(list) ? list : []).slice(0, 10)
    .map((x, i) => ({ id: text(x?.id, 40) || `q${i + 1}`, label: text(x?.label, 200), required: Boolean(x?.required) }))
    // The booking form asks for a phone number itself.
    .filter((x) => x.label && x.id !== 'phone' && !/^phone( number)?$/i.test(x.label));
}

/** Email reminders in minutes before -> whole hours before (1 to 336), at most three. */
function reminderHours(list) {
  const hours = (Array.isArray(list) ? list : []).filter((r) => !r?.channel || r.channel === 'email')
    .map((r) => Math.min(336, Math.max(1, Math.round(Number(r.minutes_before ?? 0) / 60))));
  return [...new Set(hours)].sort((a, b) => b - a).slice(0, 3);
}

const clamp = (n, min, max, dflt) => (Number.isFinite(Number(n)) && n !== null ? Math.min(max, Math.max(min, Math.round(Number(n)))) : dflt);

async function main() {
  const hub = await readStdin();
  const users = new Map((hub.users ?? []).map((u) => [String(u.id), u]));
  const rules = new Map();
  for (const r of hub.availability_rules ?? []) {
    const k = String(r.user_id);
    rules.set(k, [...(rules.get(k) ?? []), r]);
  }
  const hosts = new Map();
  for (const h of hub.event_type_hosts ?? []) {
    const k = String(h.event_type_id);
    hosts.set(k, [...(hosts.get(k) ?? []), String(h.user_id)]);
  }
  const types = hub.event_types ?? [];

  // The app creates its tables on first use; make sure it has.
  await fetch('http://127.0.0.1:3150/api/public/pages/hub-import').catch(() => {});

  const database = createDb({ max: 2 });
  const db = (q, params = []) => database.q(q, params).then((r) => r.rows);
  const log = (s) => console.log((DRY ? '[dry run] ' : '') + s);
  const [{ t }] = await db(`SELECT to_regclass('services') AS t`);
  if (!t) throw new Error('Bookings has not set up its database yet. Open Bookings once (or update the bookings image) and run this again.');

  // What to build: one page per team, one per person with event types of their own.
  const plans = [];
  for (const team of hub.teams ?? []) {
    const members = (hub.team_members ?? []).filter((m) => String(m.team_id) === String(team.id));
    const list = types.filter((x) => String(x.team_id) === String(team.id));
    if (!members.length && !list.length) continue;
    const staff = members.map((m) => ({ id: String(m.user_id), role: ['admin', 'owner'].includes(m.role) ? 'admin' : 'staff' }));
    for (const x of list) for (const h of hosts.get(String(x.id)) ?? [])
      if (!staff.some((s) => s.id === h)) staff.push({ id: h, role: 'staff' });
    const first = users.get(staff.find((s) => s.role === 'admin')?.id ?? staff[0]?.id);
    plans.push({
      label: `team ${team.name}`, slug: slugOf(team.slug, team.name), name: text(team.name, 120) || 'Bookings',
      description: text(team.description, 4000), timeZone: first?.timezone, hours: DEFAULT_HOURS, chooseStaff: false,
      staff, staffHours: true, types: list, createdAt: team.created_at,
    });
  }
  for (const u of users.values()) {
    const list = types.filter((x) => !x.team_id && String(x.user_id) === String(u.id));
    if (!list.length) continue;
    plans.push({
      label: email(u.email), slug: slugOf(u.username, u.name || email(u.email).split('@')[0]), name: text(u.name, 120) || email(u.email),
      description: '', timeZone: u.timezone, hours: weekHours(rules.get(String(u.id))) ?? DEFAULT_HOURS, chooseStaff: true,
      staff: [{ id: String(u.id), role: 'admin' }], staffHours: false, types: list, createdAt: u.created_at,
    });
  }

  let pagesAdded = 0, pagesFound = 0, staffAdded = 0, servicesAdded = 0, servicesFound = 0, skipped = 0;
  for (const p of plans) {
    const staff = p.staff.map((s) => ({ ...s, user: users.get(s.id) })).filter((s) => s.user?.email);
    const admins = staff.filter((s) => s.role === 'admin');
    if (!admins.length && staff.length) staff[0].role = 'admin', admins.push(staff[0]);
    if (!admins.length) { skipped++; log(`${p.label}: nobody on it has an email address, skipped`); continue; }
    const adminEmails = admins.map((s) => email(s.user.email));

    // The page: the first free address, or one already here with one of its admins on it.
    let page = null, slug = p.slug;
    for (let i = 1; ; i++) {
      slug = i === 1 ? p.slug : `${p.slug.slice(0, 46)}-${i}`;
      const [row] = await db(`SELECT id FROM pages WHERE slug = $1`, [slug]);
      if (!row) break;
      const [ours] = await db(`SELECT 1 FROM staff WHERE page_id = $1 AND email = ANY($2::text[])`, [row.id, adminEmails]);
      if (ours) { page = row; break; }
    }
    const services = p.types.map((x) => ({ x, slug: slugOf(x.slug, x.title) }));
    const active = p.types.filter((x) => x.active && !x.secret);
    const minNotice = Math.min(...p.types.map((x) => clamp(x.min_notice_min, 0, 43200, 120)));
    const maxDays = Math.max(...p.types.map((x) => clamp(x.window_days, 1, 365, 60)));
    const step = Math.min(...p.types.map((x) => clamp(x.slot_interval ?? x.duration_min, 5, 240, 30)));
    const tz = isTimeZone(p.timeZone) ? p.timeZone : 'UTC';

    if (page) { pagesFound++; log(`${p.label}: page /${slug} is already here`); }
    else {
      pagesAdded++;
      log(`${p.label}: page /${slug} "${p.name}" (${tz}, ${active.length ? 'published' : 'not published'})`);
      if (!DRY) [page] = await db(
        `INSERT INTO pages (slug, name, description, time_zone, hours, min_notice_min, max_days_ahead, step_min, published,
           choose_staff, created_by, created_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,COALESCE($12::timestamptz, now())) RETURNING id`,
        [slug, p.name, p.description, tz, JSON.stringify(p.hours), minNotice, maxDays, step, active.length > 0,
          p.chooseStaff, adminEmails[0], p.createdAt ?? null]);
    }

    // Staff, by email; their own availability as their hours on team pages.
    const staffIds = new Map();
    for (const s of staff) {
      const e = email(s.user.email);
      const hours = p.staffHours ? weekHours(rules.get(s.id)) : null;
      const [have] = page ? await db(`SELECT id FROM staff WHERE page_id = $1 AND email = $2`, [page.id, e]) : [];
      if (have) { staffIds.set(s.id, have.id); continue; }
      staffAdded++;
      log(`  ${e} (${s.role}${hours ? ', own hours' : ''})`);
      if (DRY) continue;
      const [row] = await db(`INSERT INTO staff (page_id, email, name, role, hours) VALUES ($1,$2,$3,$4,$5) RETURNING id`,
        [page.id, e, text(s.user.name, 120), s.role, hours ? JSON.stringify(hours) : null]);
      staffIds.set(s.id, row.id);
    }

    // Services, by address.
    for (const [position, { x, slug: sslug }] of services.entries()) {
      const [have] = page ? await db(`SELECT id FROM services WHERE page_id = $1 AND slug = $2`, [page.id, sslug]) : [];
      if (have) { servicesFound++; continue; }
      const loc = location(x);
      const offeredBy = (hosts.get(String(x.id)) ?? []).map((h) => staffIds.get(h)).filter(Boolean);
      const everyone = !offeredBy.length || offeredBy.length >= staffIds.size;
      const on = Boolean(x.active) && !x.secret;
      servicesAdded++;
      log(`  service /${sslug} "${x.title}" (${x.duration_min} min${on ? '' : ', switched off'}${everyone ? '' : `, ${offeredBy.length} of ${staffIds.size} staff`})`);
      if (x.max_per_day) log(`    note: its limit of ${x.max_per_day} a day has no equivalent here`);
      if (DRY) continue;
      await db(
        `INSERT INTO services (page_id, slug, name, description, duration_min, buffer_before_min, buffer_after_min, location_kind,
           location, price, staff_ids, questions, reminder_hours, active, position, created_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::uuid[],$12,$13::int[],$14,$15,COALESCE($16::timestamptz, now()))`,
        [page.id, sslug, text(x.title, 120) || sslug, text(x.description, 2000), clamp(x.duration_min, 5, 720, 30),
          clamp(x.buffer_before, 0, 240, 0), clamp(x.buffer_after, 0, 240, 0), loc.kind, loc.value, price(x),
          everyone ? [] : offeredBy, JSON.stringify(questions(x.questions)), reminderHours(x.reminders), on, position,
          x.created_at ?? null]);
    }
  }

  console.log(`\nPages: ${pagesAdded} added, ${pagesFound} already here${skipped ? `, ${skipped} skipped` : ''}. Staff: ${staffAdded} added. Services: ${servicesAdded} added, ${servicesFound} already here.`);
  console.log('Old booking links change: pages are now at https://bookings.<your domain>/book/<page>/<service>.');
  if (DRY) console.log('Dry run: nothing was written.');
  await database.close();
}

main().catch((e) => { console.error(e.message ?? e); process.exit(1); });
