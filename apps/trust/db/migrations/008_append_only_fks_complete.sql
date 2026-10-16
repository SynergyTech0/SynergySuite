-- Synergy Trust 008: finish what 007 started, and stop hand-maintaining the list.
--
-- 007 fixed the inbound foreign keys on the five append-only tables created in 004 — and
-- missed `auth_events`, which 006 had made append-only a migration earlier. Its guard missed
-- it too, because the guard hard-coded the same five names. So `DELETE FROM users` still
-- failed with "auth_events is append-only ... insert a correcting row (evidence.supersedes_id)".
--
-- The lesson is the defect, not the omission: a hand-maintained list of append-only tables
-- will drift from the triggers every time one is added. This migration derives the set from
-- pg_trigger instead, so adding a new append-only table automatically brings its inbound
-- keys under the same rule.

BEGIN;

-- Tables that actually refuse mutation, according to their triggers.
CREATE OR REPLACE VIEW append_only_tables AS
SELECT DISTINCT c.relname::text AS table_name
FROM pg_trigger t
JOIN pg_class c ON c.oid = t.tgrelid
JOIN pg_proc p ON p.oid = t.tgfoid
WHERE NOT t.tgisinternal
  AND p.proname = 'refuse_mutation';

COMMENT ON VIEW append_only_tables IS
  'Tables guarded by the refuse_mutation trigger. Every foreign key pointing into one of '
  'these must be ON DELETE RESTRICT: a cascade or a SET NULL is itself a mutation, and would '
  'fail inside the trigger with a message naming the wrong table.';

DO $$
DECLARE
  fk record;
BEGIN
  FOR fk IN
    SELECT c.oid,
           c.conname,
           c.conrelid::regclass::text  AS child,
           c.confrelid::regclass::text AS parent,
           a.attname                   AS col,
           pa.attname                  AS parentcol
    FROM pg_constraint c
    JOIN append_only_tables ao ON ao.table_name = c.conrelid::regclass::text
    JOIN unnest(c.conkey)  WITH ORDINALITY k(attnum, ord)  ON true
    JOIN unnest(c.confkey) WITH ORDINALITY pk(attnum, ord) ON pk.ord = k.ord
    JOIN pg_attribute a  ON a.attrelid  = c.conrelid  AND a.attnum  = k.attnum
    JOIN pg_attribute pa ON pa.attrelid = c.confrelid AND pa.attnum = pk.attnum
    WHERE c.contype = 'f'
      AND c.confdeltype NOT IN ('r', 'a')   -- not already RESTRICT / NO ACTION
  LOOP
    RAISE NOTICE 'tightening %.% -> %.%', fk.child, fk.col, fk.parent, fk.parentcol;
    EXECUTE format('ALTER TABLE %I DROP CONSTRAINT %I', fk.child, fk.conname);
    EXECUTE format(
      'ALTER TABLE %I ADD CONSTRAINT %I FOREIGN KEY (%I) REFERENCES %I(%I) ON DELETE RESTRICT',
      fk.child, fk.conname, fk.col, fk.parent, fk.parentcol);
  END LOOP;
END
$$;

-- Same check, same source of truth. Fails the migration rather than leaving a trap.
DO $$
DECLARE
  offenders int;
BEGIN
  SELECT count(*) INTO offenders
  FROM pg_constraint c
  JOIN append_only_tables ao ON ao.table_name = c.conrelid::regclass::text
  WHERE c.contype = 'f' AND c.confdeltype NOT IN ('r', 'a');

  IF offenders > 0 THEN
    RAISE EXCEPTION '% foreign key(s) into append-only tables still cascade or set null', offenders;
  END IF;
END
$$;

COMMIT;
