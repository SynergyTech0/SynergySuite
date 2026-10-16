-- Synergy Trust 007: foreign keys into append-only tables must RESTRICT.
--
-- THE BUG THIS FIXES
--
-- 004 made `evidence`, `monitor_runs`, `policy_versions`, `policy_acknowledgements` and
-- `audit_events` append-only with triggers that refuse UPDATE and DELETE. But the foreign
-- keys pointing INTO those tables were left as CASCADE or SET NULL — and a cascade is
-- exactly an UPDATE or a DELETE.
--
-- So `DELETE FROM users` would cascade `SET NULL` onto audit_events.actor_user_id, the
-- append-only trigger would fire, and the whole statement failed with:
--
--     audit_events is append-only: UPDATE refused.
--     Insert a correcting row instead (evidence.supersedes_id).
--
-- — a message about evidence, raised while deleting a user. 13 of the 15 inbound keys had
-- this shape. Nothing was ever corrupted, because the trigger did stop the write; the
-- defect is that the refusal was unintelligible and arrived from the wrong direction, which
-- is how a developer concludes the trigger is overzealous and removes it.
--
-- WHAT THE RIGHT BEHAVIOUR IS
--
-- Every one of these should refuse the parent delete, and say so plainly:
--
--   * A user who has acted cannot be deleted — attribution in the audit trail is the point.
--     Offboarding means suspending the account and removing membership, which revokes
--     access immediately and keeps the record intact. GDPR Art.17(3)(b) covers retaining it.
--   * A tenant holding evidence cannot be deleted. A compliance record is not disposable,
--     and "we deleted the customer" is not an acceptable answer to an auditor.
--   * A control with evidence, a monitor with run history, a policy with versions: same.
--     Retire or disable them; the history is the deliverable.
--
-- After this migration those operations fail with a plain foreign-key violation naming the
-- real table, instead of a trigger message about something else entirely.

BEGIN;

DO $$
DECLARE
  spec record;
  conname text;
BEGIN
  FOR spec IN
    SELECT * FROM (VALUES
      ('audit_events',            'actor_user_id',     'users',           'id'),
      ('evidence',                'control_id',        'controls',        'id'),
      ('evidence',                'tenant_id',         'tenants',         'id'),
      ('monitor_runs',            'evidence_id',       'evidence',        'id'),
      ('monitor_runs',            'monitor_id',        'monitors',        'id'),
      ('monitor_runs',            'tenant_id',         'tenants',         'id'),
      ('policy_acknowledgements', 'policy_version_id', 'policy_versions', 'id'),
      ('policy_acknowledgements', 'tenant_id',         'tenants',         'id'),
      ('policy_acknowledgements', 'user_id',           'users',           'id'),
      ('policy_versions',         'approved_by',       'users',           'id'),
      ('policy_versions',         'author_user_id',    'users',           'id'),
      ('policy_versions',         'policy_id',         'policies',        'id'),
      ('policy_versions',         'tenant_id',         'tenants',         'id')
    ) AS t(child, col, parent, parentcol)
  LOOP
    -- Look the constraint up rather than assuming the default name, so this still works if
    -- one of them was ever created explicitly.
    SELECT c.conname INTO conname
    FROM pg_constraint c
    JOIN unnest(c.conkey) AS k(attnum) ON true
    JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = k.attnum
    WHERE c.contype = 'f'
      AND c.conrelid = spec.child::regclass
      AND c.confrelid = spec.parent::regclass
      AND a.attname = spec.col
    LIMIT 1;

    IF conname IS NULL THEN
      RAISE EXCEPTION 'no foreign key found on %.% -> %', spec.child, spec.col, spec.parent;
    END IF;

    EXECUTE format('ALTER TABLE %I DROP CONSTRAINT %I', spec.child, conname);
    EXECUTE format(
      'ALTER TABLE %I ADD CONSTRAINT %I FOREIGN KEY (%I) REFERENCES %I(%I) ON DELETE RESTRICT',
      spec.child, conname, spec.col, spec.parent, spec.parentcol);
  END LOOP;
END
$$;

-- ---------------------------------------------------------------------------
-- recovery_codes should not have been append-only
-- ---------------------------------------------------------------------------
--
-- 006 gave it a no-delete trigger by analogy with the evidence tables. That was wrong on
-- two counts:
--
--   * Single use is already guaranteed by the `used_at IS NULL` predicate in the UPDATE that
--     consumes a code, which is atomic. The trigger added nothing on top of it.
--   * It made the codes undeletable, so re-enrolling a second factor left the OLD recovery
--     codes valid against the NEW secret — a silently widened authentication surface, which
--     is the opposite of what an append-only guarantee was supposed to buy. It also made the
--     user row undeletable for no reason.
--
-- Re-enrolment now replaces the set (see confirmMfaEnrolment), which requires deletes.
DROP TRIGGER IF EXISTS recovery_codes_no_delete ON recovery_codes;

-- Guard against the same mistake being reintroduced. Any FK into an append-only table that
-- is not RESTRICT or NO ACTION fails this migration loudly rather than lying dormant until
-- someone tries to delete something.
DO $$
DECLARE
  offenders int;
BEGIN
  SELECT count(*) INTO offenders
  FROM pg_constraint c
  WHERE c.contype = 'f'
    AND c.conrelid::regclass::text IN
        ('evidence','monitor_runs','policy_versions','policy_acknowledgements','audit_events')
    AND c.confdeltype NOT IN ('r', 'a');

  IF offenders > 0 THEN
    RAISE EXCEPTION
      '% foreign key(s) into append-only tables still cascade or set null', offenders;
  END IF;
END
$$;

COMMIT;
