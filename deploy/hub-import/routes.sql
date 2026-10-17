-- hub-import: container=synergyroutes-db service=crm user=synergyroutes db=synergyroutes
-- What run.sh reads from the older SynergyRoutes app's database: its CRM side, for the suite's
-- CRM. SynergyRoutes holds about 160,000 healthcare accounts (pharmacies, nursing facilities,
-- home health agencies, hospices, hospitals, practices, from CMS and other public registries)
-- with a main-line contact each, so unlike the other parts this one is not one JSON document:
-- it prints one JSON object per line, each with a "kind", and psql fetches the rows in batches
-- (FETCH_COUNT), so neither side holds the whole export in memory.
--
--   export   first line: row counts, and `left_behind`, the rows of every table that stays here
--   user     id and email only (never password hashes or tokens), to match owners by email
--   account  the account with its address, position, entity type, route-planning fields and
--            the `custom` registry facts
--   contact, opportunity, activity
--
-- Territories, routes and route stops are route planning and stay behind, as do geocoding
-- bookkeeping, the PostGIS `location` (lat and lng come across) and the contacts' leadscout data.
\set FETCH_COUNT 2000

SELECT json_build_object(
  'kind', 'export',
  'source', 'synergyroutes',
  'counts', json_build_object(
    'users', (SELECT count(*) FROM users),
    'accounts', (SELECT count(*) FROM accounts),
    'contacts', (SELECT count(*) FROM contacts),
    'opportunities', (SELECT count(*) FROM opportunities),
    'activities', (SELECT count(*) FROM activities)),
  'left_behind', (SELECT coalesce(json_object_agg(t.table_name, t.n), '{}') FROM (
    SELECT table_name, (xpath('/row/n/text()', query_to_xml(format('SELECT count(*) AS n FROM %I', table_name), false, true, '')))[1]::text::int AS n
    FROM information_schema.tables
    WHERE table_schema = current_schema() AND table_type = 'BASE TABLE' AND table_name NOT IN (
      'users', 'accounts', 'contacts', 'opportunities', 'activities', 'spatial_ref_sys')) t WHERE t.n > 0)
);

SELECT json_build_object('kind', 'user', 'id', id, 'email', email) FROM users;

SELECT json_build_object(
  'kind', 'account', 'id', a.id, 'owner_id', a.owner_id, 'type', a.kind, 'name', a.name,
  'address_line1', a.address_line1, 'address_line2', a.address_line2, 'city', a.city, 'state', a.state, 'zip', a.zip,
  'lat', a.lat, 'lng', a.lng, 'entity_type', a.entity_type, 'priority', a.priority,
  'visit_frequency_days', a.visit_frequency_days, 'last_visited_at', a.last_visited_at, 'next_action_at', a.next_action_at,
  'crm_source', a.crm_source, 'crm_external_id', a.crm_external_id, 'custom', a.custom,
  'created_at', a.created_at, 'updated_at', a.updated_at)
FROM accounts a;

SELECT json_build_object(
  'kind', 'contact', 'id', c.id, 'account_id', c.account_id, 'name', c.name, 'title', c.title, 'email', c.email,
  'phone', c.phone, 'source', c.source, 'created_at', c.created_at)
FROM contacts c;

SELECT json_build_object(
  'kind', 'opportunity', 'id', o.id, 'account_id', o.account_id, 'owner_id', o.owner_id, 'name', o.name,
  'amount', o.amount::text, 'stage', o.stage, 'probability', o.probability, 'close_date', o.close_date,
  'created_at', o.created_at, 'updated_at', o.updated_at)
FROM opportunities o;

SELECT json_build_object(
  'kind', 'activity', 'id', t.id, 'account_id', t.account_id, 'contact_id', t.contact_id, 'opportunity_id', t.opportunity_id,
  'assignee_id', t.assignee_id, 'type', t.type, 'subject', t.subject, 'body', t.body, 'due_date', t.due_date,
  'status', t.status, 'scheduled_at', t.scheduled_at, 'duration_min', t.duration_min, 'location', t.location,
  'meeting_url', t.meeting_url, 'created_at', t.created_at, 'updated_at', t.updated_at)
FROM activities t;
