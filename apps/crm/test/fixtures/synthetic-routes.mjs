// Prints a synthetic SynergyRoutes export (deploy/hub-import/routes.sql's format) of the real
// one's size, for timing the importer:
//   node test/fixtures/synthetic-routes.mjs [accounts=163364] | node scripts/import-hub.mjs
// Ids follow from each row's number, so a second run updates the first one's rows.

const N = Number(process.argv[2]) || 163364;
const TYPES = [['Pharmacy', 111000], ['Skilled Nursing Facility', 15000], ['Home Health Agency', 11000], ['Dialysis Facility', 7500],
  ['Hospice', 6500], ['Hospital', 5000], ['Physician Practice', 4500], ['Therapy Practice', 2864]];
const STATES = ['TX', 'CA', 'FL', 'NY', 'PA', 'OH', 'IL', 'GA', 'NC', 'MI', 'AZ', 'TN', 'WA', 'MO', 'IN', 'CO', 'LA', 'AL', 'OK', 'KY'];
const WORDS = ['Main Street', 'Sunrise', 'Hill Country', 'Lakeside', 'Riverbend', 'Oak Grove', 'Pioneer', 'Cedar', 'Liberty', 'Summit', 'Valley', 'Harbor'];
const uuid = (kind, i) => `${kind}0000000-0000-4000-8000-${String(i).padStart(12, '0')}`;
const users = Array.from({ length: 7 }, (_, i) => ({ id: uuid(9, i), email: `rep${i + 1}@routes.example` }));
const accountIds = [];

let buf = [];
const out = (o) => {
  buf.push(JSON.stringify(o));
  if (buf.length >= 2000) flush();
};
const flush = () => {
  if (buf.length) process.stdout.write(buf.join('\n') + '\n');
  buf = [];
};
const typeOf = (i) => {
  let n = i % 163364;
  for (const [t, c] of TYPES) { if (n < c) return t; n -= c; }
  return 'Pharmacy';
};

out({ kind: 'export', source: 'synergyroutes', counts: { users: 7, accounts: N, contacts: N, opportunities: 2, activities: 2 }, left_behind: { territories: 52 } });
for (const u of users) out({ kind: 'user', ...u });
for (let i = 0; i < N; i++) {
  const id = uuid(1, i);
  accountIds.push(id);
  const t = typeOf(i);
  const st = STATES[i % STATES.length];
  out({
    kind: 'account', id, owner_id: users[i % users.length].id, type: 'prospect',
    name: `${WORDS[i % WORDS.length]} ${t} ${i}`, address_line1: `${100 + (i % 9000)} ${WORDS[(i >> 3) % WORDS.length]} Rd`, address_line2: i % 7 ? null : `Suite ${i % 300}`,
    city: `City ${i % 2000}`, state: st, zip: String(10000 + (i % 89999)), lat: 25 + (i % 2000) / 100, lng: -120 + (i % 4000) / 100,
    entity_type: t, priority: i % 5 || null, visit_frequency_days: i % 3 ? 30 : null, last_visited_at: i % 11 ? null : '2026-03-04T15:30:00+00:00',
    next_action_at: i % 13 ? null : '2026-04-01', crm_source: null, crm_external_id: null,
    custom: t === 'Pharmacy'
      ? { County: `County ${i % 250}`, 'License Number': `PH-${i}`, 'Primary Taxonomy': 'Pharmacy - Community/Retail', 'Exp. Date': '2027-12-31' }
      : { County: `County ${i % 250}`, 'Certified Beds': i % 200, 'Five Star': String(1 + (i % 5)), 'Ownership Type': 'For profit - Corporation',
          'Certification Date': '1999-05-01', 'Offers Nursing Care Services': true, 'Chain Organization': i % 4 ? null : 'Big Chain Health' },
    created_at: '2025-01-02T10:00:00+00:00', updated_at: '2025-06-02T10:00:00+00:00',
  });
}
for (let i = 0; i < N; i++) {
  out({ kind: 'contact', id: uuid(2, i), account_id: accountIds[i], name: i % 9 ? 'Main line' : null, title: null, email: null,
    phone: `(${200 + (i % 700)}) 555-${String(i % 10000).padStart(4, '0')}`, source: 'cms', created_at: '2025-01-02T10:00:00+00:00' });
}
out({ kind: 'opportunity', id: uuid(3, 0), account_id: accountIds[0], owner_id: users[0].id, name: 'Deal one', amount: '1000.00', stage: 'proposal', probability: 50, close_date: '2026-12-01', created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z' });
out({ kind: 'opportunity', id: uuid(3, 1), account_id: accountIds[1], owner_id: users[1].id, name: 'Deal two', amount: '2000.00', stage: 'negotiation', probability: null, close_date: null, created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z' });
out({ kind: 'activity', id: uuid(4, 0), account_id: accountIds[0], contact_id: null, opportunity_id: null, assignee_id: users[0].id, type: 'visit', subject: 'Drop by', body: '', due_date: '2026-05-01', status: 'open', scheduled_at: null, duration_min: 30, location: null, meeting_url: null, created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z' });
out({ kind: 'activity', id: uuid(4, 1), account_id: accountIds[1], contact_id: null, opportunity_id: null, assignee_id: users[1].id, type: 'call', subject: 'Call', body: 'Left a message', due_date: null, status: 'completed', scheduled_at: null, duration_min: null, location: null, meeting_url: null, created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z' });
flush();
