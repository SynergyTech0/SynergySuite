-- Synergy Trust 009: collector agents.
--
-- WHY AN AGENT EXISTS
--
-- Host collectors currently reach out over SSH from the server. That works for a
-- self-hosted deployment, and for a single organisation. It does not work for SaaS, for two
-- separate reasons:
--
--   1. CUSTODY. It means the vendor holds credentials into customer infrastructure. No
--      serious customer should accept that, and no serious vendor should want it.
--   2. REACHABILITY. Plenty of hosts simply cannot be reached inbound: a host whose port 22
--      is filtered from the collector cannot be measured over SSH at all, so the coverage
--      gap has to be declared rather than closed.
--
-- An agent inverts the direction. It runs ON the host, collects locally — no SSH transport
-- at all, because it is already there — and posts results outbound to an endpoint it
-- authenticates to. Nothing needs to be open inbound, and the vendor holds no keys.
--
-- The agent is deliberately NOT trusted to decide what to measure. It asks for its
-- assignments and may only report against monitors bound to it; anything else is refused.
-- An agent token is a credential for submitting observations, not for defining them.

BEGIN;

CREATE TABLE agents (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name          text NOT NULL,
  -- What the agent reports about. Recorded by the operator at enrolment so that a result
  -- can be attributed to a machine even if the agent is later re-installed.
  host_label    text NOT NULL,
  -- SHA-256 of the bearer token. The raw value is shown once at enrolment and never stored,
  -- same as an invitation or a session.
  token_hash    text NOT NULL UNIQUE,
  version       text,
  enabled       boolean NOT NULL DEFAULT true,
  last_seen_at  timestamptz,
  last_report_at timestamptz,
  created_by    uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  revoked_at    timestamptz,
  UNIQUE (tenant_id, name)
);

CREATE INDEX agents_tenant_idx ON agents(tenant_id);

-- A monitor either runs on the server or is owned by an agent. When agent_id is set the
-- server-side runner skips it entirely — it could not reach the host anyway, and a nightly
-- `error` from the server would bury the agent's real result.
ALTER TABLE monitors
  ADD COLUMN agent_id uuid REFERENCES agents(id) ON DELETE RESTRICT;

CREATE INDEX monitors_agent_idx ON monitors(agent_id) WHERE agent_id IS NOT NULL;

-- RLS, consistent with every other tenant table.
ALTER TABLE agents ENABLE ROW LEVEL SECURITY;
ALTER TABLE agents FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON agents
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

GRANT SELECT, INSERT, UPDATE, DELETE ON agents TO strust_app;
GRANT SELECT ON agents TO strust_app_ro;

COMMIT;
