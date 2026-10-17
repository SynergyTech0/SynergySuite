-- hub-import: container=scadence-db service=bookings
-- What run.sh reads from an older Synergy Hub's Booking by Synergy (Cadence) database: people
-- (email, name, user name, time zone; no password hashes), teams and who is on them, event
-- types with their hosts, and weekly availability. Bookings, sessions, calendar connections,
-- webhooks, jobs and invites stay behind.
SELECT json_build_object(
  'users', (SELECT coalesce(json_agg(u ORDER BY u.id), '[]') FROM (
    SELECT id, email, name, username, timezone, created_at FROM users) u),
  'teams', (SELECT coalesce(json_agg(t ORDER BY t.id), '[]') FROM (
    SELECT id, name, slug, description, created_at FROM teams) t),
  'team_members', (SELECT coalesce(json_agg(m), '[]') FROM (SELECT team_id, user_id, role FROM team_members) m),
  'event_types', (SELECT coalesce(json_agg(e ORDER BY e.id), '[]') FROM (
    SELECT id, user_id, team_id, kind, title, slug, description, duration_min, location_type, location_value,
           buffer_before, buffer_after, min_notice_min, window_days, slot_interval, max_per_day, questions,
           reminders, price_cents, currency, active, secret, created_at
    FROM event_types WHERE NOT deleted) e),
  'event_type_hosts', (SELECT coalesce(json_agg(h), '[]') FROM (SELECT event_type_id, user_id, priority FROM event_type_hosts) h),
  'availability_rules', (SELECT coalesce(json_agg(r ORDER BY r.user_id, r.weekday, r.start_min), '[]') FROM (
    SELECT user_id, weekday, start_min, end_min FROM availability_rules) r)
);
