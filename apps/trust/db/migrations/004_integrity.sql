-- Synergy Trust 004: append-only enforcement and the hash-chained self-audit log.
--
-- The whole product rests on evidence an auditor will believe. Evidence that the vendor
-- can silently rewrite is worth nothing, so immutability is enforced here by the database
-- rather than promised by the application. Application-level discipline is one careless
-- UPDATE away from being untrue, and nobody would ever see it happen.

BEGIN;

-- ---------------------------------------------------------------------------
-- Append-only guard
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION refuse_mutation() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION
    '% is append-only: % refused. Insert a correcting row instead (evidence.supersedes_id).',
    TG_TABLE_NAME, TG_OP
    USING ERRCODE = 'restrict_violation';
END;
$$;

CREATE TRIGGER evidence_no_update BEFORE UPDATE ON evidence
  FOR EACH ROW EXECUTE FUNCTION refuse_mutation();
CREATE TRIGGER evidence_no_delete BEFORE DELETE ON evidence
  FOR EACH ROW EXECUTE FUNCTION refuse_mutation();

CREATE TRIGGER monitor_runs_no_update BEFORE UPDATE ON monitor_runs
  FOR EACH ROW EXECUTE FUNCTION refuse_mutation();
CREATE TRIGGER monitor_runs_no_delete BEFORE DELETE ON monitor_runs
  FOR EACH ROW EXECUTE FUNCTION refuse_mutation();

-- A policy version is the artifact under audit. Approving it then editing the body would
-- let the approved text and the enforced text diverge invisibly.
CREATE TRIGGER policy_versions_no_update BEFORE UPDATE ON policy_versions
  FOR EACH ROW EXECUTE FUNCTION refuse_mutation();
CREATE TRIGGER policy_versions_no_delete BEFORE DELETE ON policy_versions
  FOR EACH ROW EXECUTE FUNCTION refuse_mutation();

CREATE TRIGGER policy_acks_no_update BEFORE UPDATE ON policy_acknowledgements
  FOR EACH ROW EXECUTE FUNCTION refuse_mutation();
CREATE TRIGGER policy_acks_no_delete BEFORE DELETE ON policy_acknowledgements
  FOR EACH ROW EXECUTE FUNCTION refuse_mutation();

-- ---------------------------------------------------------------------------
-- Self-audit log: hash-chained, per tenant
-- ---------------------------------------------------------------------------
--
-- A GRC tool has to be auditable itself - CC7.2/CC7.3 and ISO A.8.15 apply to us as much
-- as to our tenants. The chain makes a deletion detectable rather than merely forbidden:
-- removing a link breaks every hash after it.

CREATE TABLE audit_events (
  id            bigserial PRIMARY KEY,
  tenant_id     uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  seq           bigint NOT NULL,
  actor_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  actor_label   text,            -- for non-user actors: 'collector:tls_endpoint', 'system'
  action        text NOT NULL,   -- 'control.implemented', 'evidence.collected', ...
  object_type   text NOT NULL,
  object_id     text,
  payload       jsonb NOT NULL DEFAULT '{}'::jsonb,
  prev_hash     text,
  hash          text NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, seq)
);

CREATE INDEX audit_events_tenant_time_idx ON audit_events(tenant_id, created_at DESC);

-- seq and hash are assigned server-side. A caller cannot choose where in the chain its
-- event lands, so it cannot forge a predecessor.
CREATE OR REPLACE FUNCTION audit_events_link() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  last_seq  bigint;
  last_hash text;
BEGIN
  SELECT seq, hash INTO last_seq, last_hash
  FROM audit_events
  WHERE tenant_id = NEW.tenant_id
  ORDER BY seq DESC
  LIMIT 1;

  NEW.seq       := COALESCE(last_seq, 0) + 1;
  NEW.prev_hash := last_hash;
  NEW.hash := encode(digest(
    COALESCE(last_hash, '') || '|' ||
    NEW.tenant_id::text    || '|' ||
    NEW.seq::text          || '|' ||
    NEW.action             || '|' ||
    NEW.object_type        || '|' ||
    COALESCE(NEW.object_id, '') || '|' ||
    NEW.payload::text,
    'sha256'), 'hex');

  RETURN NEW;
END;
$$;

CREATE TRIGGER audit_events_link_trg BEFORE INSERT ON audit_events
  FOR EACH ROW EXECUTE FUNCTION audit_events_link();

CREATE TRIGGER audit_events_no_update BEFORE UPDATE ON audit_events
  FOR EACH ROW EXECUTE FUNCTION refuse_mutation();
CREATE TRIGGER audit_events_no_delete BEFORE DELETE ON audit_events
  FOR EACH ROW EXECUTE FUNCTION refuse_mutation();

-- Recomputes the chain and returns the first seq where it breaks. NULL means intact.
-- Verification has to be callable on demand; an integrity claim nobody can re-derive is
-- just a nicer-sounding assertion.
CREATE OR REPLACE FUNCTION verify_audit_chain(p_tenant uuid)
RETURNS TABLE (broken_at bigint, expected text, found text)
LANGUAGE plpgsql AS $$
DECLARE
  r         record;
  running   text := NULL;
  recomputed text;
BEGIN
  FOR r IN
    SELECT * FROM audit_events WHERE tenant_id = p_tenant ORDER BY seq ASC
  LOOP
    recomputed := encode(digest(
      COALESCE(running, '') || '|' ||
      r.tenant_id::text     || '|' ||
      r.seq::text           || '|' ||
      r.action              || '|' ||
      r.object_type         || '|' ||
      COALESCE(r.object_id, '') || '|' ||
      r.payload::text,
      'sha256'), 'hex');

    IF recomputed <> r.hash THEN
      RETURN QUERY SELECT r.seq, recomputed, r.hash;
      RETURN;
    END IF;

    running := r.hash;
  END LOOP;
  RETURN;
END;
$$;

COMMIT;
