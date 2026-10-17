-- hub-import: container=strust-db service=trust
-- What run.sh reads from an older Synergy Hub's SynergyTrust database: organisations,
-- people (email, name, status only), memberships, the compliance program (frameworks in
-- scope, controls and their mappings, evidence, monitors and their run history, policies,
-- risks, vendors, personnel, assets, GDPR records, audits, collector agents, trust centre)
-- and both logs (the hash-chained audit trail and the access log). Catalog rows are named
-- by their keys, not ids, so they map onto the suite's own seeded catalog.
-- Passwords, second factors, recovery codes, sessions and invitation tokens stay behind;
-- people sign in through the suite now. Evidence content is in `payload`; the old app kept
-- no files.
SELECT json_build_object(
  'tenants', (SELECT coalesce(json_agg(t ORDER BY t.created_at), '[]') FROM (
    SELECT id, slug, name, status, created_at FROM tenants) t),
  'users', (SELECT coalesce(json_agg(u ORDER BY u.created_at), '[]') FROM (
    SELECT id, lower(email) AS email, name, status, created_at, last_login_at FROM users) u),
  'tenant_members', (SELECT coalesce(json_agg(m), '[]') FROM (
    SELECT tenant_id, user_id, role, created_at FROM tenant_members) m),
  'tenant_frameworks', (SELECT coalesce(json_agg(x), '[]') FROM (
    SELECT tf.id, tf.tenant_id, f.key AS framework, f.version AS framework_version, tf.status,
           tf.target_date, tf.scope_note, tf.created_at,
           (SELECT coalesce(json_agg(s.key), '[]') FROM tenant_framework_scope sc
              JOIN framework_sections s ON s.id = sc.section_id
             WHERE sc.tenant_framework_id = tf.id) AS scope
      FROM tenant_frameworks tf JOIN frameworks f ON f.id = tf.framework_id) x),
  'controls', (SELECT coalesce(json_agg(x ORDER BY x.created_at), '[]') FROM (
    SELECT c.id, c.tenant_id, t.key AS template, c.key, c.title, c.objective, c.owner_user_id,
           c.status, c.na_rationale, c.notes, c.created_at, c.updated_at
      FROM controls c LEFT JOIN control_templates t ON t.id = c.template_id) x),
  'control_requirement_map', (SELECT coalesce(json_agg(x), '[]') FROM (
    SELECT m.control_id, f.key AS framework, f.version AS framework_version, r.key AS requirement,
           m.coverage, m.rationale
      FROM control_requirement_map m JOIN requirements r ON r.id = m.requirement_id
      JOIN frameworks f ON f.id = r.framework_id) x),
  'evidence', (SELECT coalesce(json_agg(e ORDER BY e.created_at, e.id), '[]') FROM (
    SELECT id, tenant_id, control_id, kind, title, collected_at, collector, collector_version,
           content_hash, content_type, storage_uri, payload, supersedes_id, created_at FROM evidence) e),
  -- An agent's token is kept only as its hash, so a live agent keeps working once it is
  -- pointed at the suite. A revoked agent's hash is of no use to anyone and is left behind.
  'agents', (SELECT coalesce(json_agg(a), '[]') FROM (
    SELECT id, tenant_id, name, host_label,
           CASE WHEN revoked_at IS NULL THEN token_hash END AS token_hash,
           version, enabled, last_seen_at, last_report_at, created_by, created_at, revoked_at FROM agents) a),
  'monitors', (SELECT coalesce(json_agg(m), '[]') FROM (
    SELECT id, tenant_id, control_id, key, title, kind, config, schedule, severity, enabled,
           agent_id, created_at FROM monitors) m),
  'monitor_runs', (SELECT coalesce(json_agg(r ORDER BY r.started_at, r.id), '[]') FROM (
    SELECT id, tenant_id, monitor_id, started_at, finished_at, status, message, observed,
           evidence_id, created_at FROM monitor_runs) r),
  'policies', (SELECT coalesce(json_agg(p), '[]') FROM (
    SELECT id, tenant_id, key, title, owner_user_id, status, review_cadence, review_due,
           created_at FROM policies) p),
  'policy_versions', (SELECT coalesce(json_agg(v ORDER BY v.created_at), '[]') FROM (
    SELECT id, tenant_id, policy_id, version, body_md, content_hash, author_user_id,
           approved_by, approved_at, effective_at, created_at FROM policy_versions) v),
  'policy_acknowledgements', (SELECT coalesce(json_agg(a), '[]') FROM (
    SELECT id, tenant_id, policy_version_id, user_id, acknowledged_at FROM policy_acknowledgements) a),
  'risks', (SELECT coalesce(json_agg(r), '[]') FROM (
    SELECT id, tenant_id, key, title, description, category, likelihood, impact, treatment,
           residual_likelihood, residual_impact, owner_user_id, status, review_due, created_at FROM risks) r),
  'risk_control_map', (SELECT coalesce(json_agg(m), '[]') FROM (
    SELECT tenant_id, risk_id, control_id FROM risk_control_map) m),
  'vendors', (SELECT coalesce(json_agg(v), '[]') FROM (
    SELECT id, tenant_id, name, category, criticality, processes_personal_data, processes_phi,
           is_subprocessor, dpa_status, baa_status, assurance_report, review_due, owner_user_id,
           created_at FROM vendors) v),
  'personnel', (SELECT coalesce(json_agg(p), '[]') FROM (
    SELECT id, tenant_id, user_id, full_name, lower(email) AS email, role_title, start_date,
           end_date, status, background_check_at, security_training_at, created_at FROM personnel) p),
  'assets', (SELECT coalesce(json_agg(a), '[]') FROM (
    SELECT id, tenant_id, key, name, kind, classification, owner_user_id, location, notes,
           created_at FROM assets) a),
  'processing_activities', (SELECT coalesce(json_agg(p), '[]') FROM (
    SELECT id, tenant_id, name, purpose, lawful_basis, data_categories, special_category,
           data_subjects, recipients, retention, transfers_outside_eea, transfer_safeguard,
           dpia_required, dpia_ref, created_at FROM processing_activities) p),
  'dsar_requests', (SELECT coalesce(json_agg(d), '[]') FROM (
    SELECT id, tenant_id, subject_email, kind, received_at, due_at, status, refusal_reason,
           resolved_at, created_at FROM dsar_requests) d),
  'audits', (SELECT coalesce(json_agg(x), '[]') FROM (
    SELECT a.id, a.tenant_id, f.key AS framework, f.version AS framework_version, a.kind,
           a.period_start, a.period_end, a.auditor_firm, a.status, a.report_uri, a.created_at
      FROM audits a JOIN frameworks f ON f.id = a.framework_id) x),
  'trust_centers', (SELECT coalesce(json_agg(x), '[]') FROM (
    SELECT tc.tenant_id, tc.enabled, tc.public_slug, tc.headline, tc.intro, tc.security_contact,
           tc.show_frameworks, tc.show_control_counts, tc.show_policies, tc.show_subprocessors,
           tc.updated_by, tc.updated_at, tc.created_at,
           (SELECT coalesce(json_agg(json_build_object('key', f.key, 'version', f.version)), '[]')
              FROM trust_center_frameworks tcf JOIN frameworks f ON f.id = tcf.framework_id
             WHERE tcf.tenant_id = tc.tenant_id) AS frameworks
      FROM trust_centers tc) x),
  -- The chain is rebuilt under the suite's tenant (seq and hash are assigned on insert), so
  -- the old chain's head and whether it verified come along as a record of what was moved.
  'audit_chains', (SELECT coalesce(json_agg(x), '[]') FROM (
    SELECT t.id AS tenant_id, count(e.id) AS events, max(e.seq) AS last_seq,
           (SELECT hash FROM audit_events WHERE tenant_id = t.id ORDER BY seq DESC LIMIT 1) AS last_hash,
           NOT EXISTS (SELECT 1 FROM verify_audit_chain(t.id)) AS intact
      FROM tenants t LEFT JOIN audit_events e ON e.tenant_id = t.id GROUP BY t.id) x),
  'audit_events', (SELECT coalesce(json_agg(e ORDER BY e.tenant_id, e.seq), '[]') FROM (
    SELECT id, tenant_id, seq, actor_user_id, actor_label, action, object_type, object_id,
           payload, created_at FROM audit_events) e),
  'auth_events', (SELECT coalesce(json_agg(e ORDER BY e.id), '[]') FROM (
    SELECT id, at, event, lower(email) AS email, user_id, tenant_id, ip, user_agent, detail FROM auth_events) e)
);
