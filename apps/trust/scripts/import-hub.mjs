// Brings an older Synergy Hub's SynergyTrust data into this Trust. Reads the hub's export
// (deploy/hub-import/trust.sql) as JSON on stdin; deploy/hub-import/run.sh does both steps.
//
//   node scripts/import-hub.mjs [--dry-run] [--tenant <slug>] [--from <old-slug>]
//
// WHERE IT GOES
//
// Into one organisation here: the one named by --tenant, else the only one there is. With
// none yet, it is created under the hub organisation's name, the same way the first suite
// user's organisation is (trust_provision_tenant). With several and no --tenant it stops
// and lists them. A hub with several organisations needs --from to pick one per run.
//
// WHAT COMES ACROSS
//
//   - People, matched by email. Sign-in is the suite's now, so only email, name and status
//     come along; anyone whose row already exists here keeps it. Hub memberships become
//     memberships here (an existing membership keeps its role), so each person has access
//     the first time they open Trust through the suite.
//   - The program: frameworks in scope, controls (matched by key; a control still untouched
//     here takes the hub's status, owner and notes), their requirement mappings, evidence,
//     agents, monitors and their run history, policies and versions, risks, vendors,
//     personnel, assets, GDPR records, audits and the trust centre.
//   - Catalog rows (frameworks, requirements, control templates) are never copied: they are
//     matched to this install's seeded catalog by key, and an unmatched key stops the run.
//   - Both logs. audit_events is hash-chained per organisation and the chain is rebuilt
//     here as the events are appended (oldest first, original times kept); a closing
//     `hub.imported` event records the hub chain's length, head hash and whether it
//     verified. auth_events (the hub's sign-in history) is kept as history.
//
// Rows keep their hub ids where they are new, so ids inside evidence and audit payloads
// still resolve. hub_import_ids records every hub id and where it landed, which is what
// makes a second run add nothing. --dry-run does the whole import and rolls it back.

import { adminSql } from '../src/lib/db.mjs';

const argv = process.argv.slice(2);
const DRY = argv.includes('--dry-run');
const opt = (flag) => (argv.includes(flag) ? argv[argv.indexOf(flag) + 1] : null);
const TENANT = opt('--tenant');
const FROM = opt('--from');
const DEFAULT_NAME = process.env.TRUST_COMPANY_NAME?.trim() || 'My Company';

async function readStdin() {
  const chunks = [];
  for await (const c of process.stdin) chunks.push(c);
  const text = Buffer.concat(chunks).toString('utf8').trim();
  if (!text) throw new Error('No hub export on stdin. Run deploy/hub-import/run.sh.');
  return JSON.parse(text);
}

/** Same rule as slugFor() in src/lib/auth.ts. */
function slugFor(name) {
  const base = name.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '').slice(0, 34).replace(/-+$/g, '');
  return base.length >= 3 ? base : `org-${base || 'trust'}`.slice(0, 34);
}

class DryRun extends Error {}

const sql = adminSql({ max: 1 });
const log = (s) => console.log((DRY ? '[dry run] ' : '') + s);

async function main() {
  const hub = await readStdin();
  const rows = (k) => hub[k] ?? [];

  const [{ n: seeded }] = await sql`SELECT count(*)::int AS n FROM frameworks`;
  if (!seeded) throw new Error('The framework catalog is not seeded here yet. Start Trust once (or run scripts/seed.mjs) first.');

  const oldTenants = rows('tenants');
  if (!oldTenants.length) { console.log('The hub has no organisation; nothing to import.'); return; }
  const source = FROM ? oldTenants.find((t) => t.slug === FROM) : oldTenants.length === 1 ? oldTenants[0] : null;
  if (!source) {
    throw new Error(FROM
      ? `The hub has no organisation '${FROM}'.`
      : `The hub has ${oldTenants.length} organisations; pick one with --from (${oldTenants.map((t) => t.slug).join(', ')}).`);
  }
  const mine = (r) => r.tenant_id === source.id;

  const counts = {};
  const add = (k, what) => { counts[k] ??= { added: 0, matched: 0, kept: 0 }; counts[k][what]++; };

  try {
    await sql.begin(async (tx) => {
      await tx`
        CREATE TABLE IF NOT EXISTS hub_import_ids (
          kind        text NOT NULL,
          old_id      text NOT NULL,
          new_id      text NOT NULL,
          imported_at timestamptz NOT NULL DEFAULT now(),
          PRIMARY KEY (kind, old_id)
        )`;
      // Earlier runs: hub id -> id here, per kind.
      const ids = new Map();
      for (const r of await tx`SELECT kind, old_id, new_id FROM hub_import_ids`) ids.set(`${r.kind}:${r.old_id}`, r.new_id);
      const seen = (kind, old) => ids.get(`${kind}:${old}`);
      const remember = async (kind, old, id) => {
        ids.set(`${kind}:${old}`, String(id));
        await tx`INSERT INTO hub_import_ids (kind, old_id, new_id) VALUES (${kind}, ${String(old)}, ${String(id)})
                 ON CONFLICT (kind, old_id) DO NOTHING`;
      };
      const ref = (kind, old) => (old == null ? null : seen(kind, old) ?? null);

      // ---------------------------------------------------------------- catalog
      const fwRows = await tx`SELECT id, key, version FROM frameworks ORDER BY version DESC`;
      const framework = (key, version) => {
        const f = fwRows.find((x) => x.key === key && x.version === version) ?? fwRows.find((x) => x.key === key);
        if (!f) throw new Error(`framework '${key}' is not in this catalog`);
        return f.id;
      };
      const reqIds = new Map();
      for (const r of await tx`SELECT r.id, r.framework_id, r.key FROM requirements r`) reqIds.set(`${r.framework_id}|${r.key}`, r.id);
      const secIds = new Map();
      for (const s of await tx`SELECT id, framework_id, key FROM framework_sections`) secIds.set(`${s.framework_id}|${s.key}`, s.id);
      const tplIds = new Map();
      for (const t of await tx`SELECT id, key FROM control_templates`) tplIds.set(t.key, t.id);
      const unresolved = new Set();
      for (const m of rows('control_requirement_map')) {
        if (!reqIds.has(`${framework(m.framework, m.framework_version)}|${m.requirement}`)) unresolved.add(`${m.framework}:${m.requirement}`);
      }
      if (unresolved.size) {
        throw new Error(`The hub maps controls to ${unresolved.size} requirement(s) this catalog does not have:\n    ${[...unresolved].join('\n    ')}`);
      }

      // ---------------------------------------------------------------- organisation
      let tenant;
      if (TENANT) {
        [tenant] = await tx`SELECT id, slug, name FROM tenants WHERE slug = ${TENANT}`;
        if (!tenant) throw new Error(`No organisation '${TENANT}' here.`);
      } else {
        const all = await tx`SELECT id, slug, name FROM tenants ORDER BY created_at`;
        if (all.length > 1) throw new Error(`There are ${all.length} organisations here; pick one with --tenant (${all.map((t) => t.slug).join(', ')}).`);
        tenant = all[0];
      }
      if (!tenant) {
        let slug = /^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$/.test(source.slug) ? source.slug : slugFor(source.name);
        for (let n = 2; (await tx`SELECT 1 FROM tenants WHERE slug = ${slug}`).length; n++) slug = `${slugFor(source.name)}-${n}`;
        const [{ id }] = await tx`SELECT trust_provision_tenant(${slug}, ${source.name}) AS id`;
        tenant = { id, slug, name: source.name };
        log(`created organisation ${source.name} (${slug})`);
      } else {
        log(`importing into ${tenant.name} (${tenant.slug})`);
        if (tenant.name === DEFAULT_NAME && source.name !== tenant.name) {
          await tx`UPDATE tenants SET name = ${source.name} WHERE id = ${tenant.id}`;
          log(`renamed ${tenant.name} to ${source.name}`);
        }
      }
      // Tenant-scoped tables have FORCE ROW LEVEL SECURITY; everything below is this tenant's.
      await tx`SELECT set_config('app.tenant_id', ${tenant.id}, true)`;
      await remember('tenant', source.id, tenant.id);

      // ---------------------------------------------------------------- people
      for (const u of rows('users')) {
        if (seen('user', u.id)) { add('people', 'kept'); continue; }
        const [found] = await tx`SELECT id FROM users WHERE lower(email) = ${u.email}`;
        if (found) { await remember('user', u.id, found.id); add('people', 'matched'); continue; }
        const [made] = await tx`
          INSERT INTO users (id, email, name, status, created_at, last_login_at)
          VALUES (${u.id}, ${u.email}, ${u.name || u.email}, ${u.status === 'suspended' ? 'suspended' : 'active'},
                  ${u.created_at}, ${u.last_login_at})
          RETURNING id`;
        await remember('user', u.id, made.id); add('people', 'added');
      }
      const user = (old) => ref('user', old);

      for (const m of rows('tenant_members').filter(mine)) {
        const [r] = await tx`
          INSERT INTO tenant_members (tenant_id, user_id, role, created_at)
          VALUES (${tenant.id}, ${user(m.user_id)}, ${m.role}, ${m.created_at})
          ON CONFLICT (tenant_id, user_id) DO NOTHING RETURNING user_id`;
        add('memberships', r ? 'added' : 'kept');
      }

      // ---------------------------------------------------------------- frameworks in scope
      for (const f of rows('tenant_frameworks').filter(mine)) {
        const fwId = framework(f.framework, f.framework_version);
        let [tf] = await tx`SELECT id, status, target_date FROM tenant_frameworks WHERE tenant_id = ${tenant.id} AND framework_id = ${fwId}`;
        if (!tf) {
          [tf] = await tx`
            INSERT INTO tenant_frameworks (id, tenant_id, framework_id, status, target_date, scope_note, created_at)
            VALUES (${f.id}, ${tenant.id}, ${fwId}, ${f.status}, ${f.target_date}, ${f.scope_note}, ${f.created_at})
            RETURNING id`;
          add('frameworks in scope', 'added');
        } else if (!seen('tenant_framework', f.id) && tf.status === 'scoping' && !tf.target_date) {
          await tx`UPDATE tenant_frameworks SET status = ${f.status}, target_date = ${f.target_date}, scope_note = ${f.scope_note}
                   WHERE id = ${tf.id}`;
          add('frameworks in scope', 'matched');
        } else add('frameworks in scope', 'kept');
        await remember('tenant_framework', f.id, tf.id);
        for (const key of f.scope ?? []) {
          const sec = secIds.get(`${fwId}|${key}`);
          if (!sec) throw new Error(`section ${f.framework}:${key} is not in this catalog`);
          await tx`INSERT INTO tenant_framework_scope (tenant_framework_id, section_id) VALUES (${tf.id}, ${sec}) ON CONFLICT DO NOTHING`;
        }
      }

      // ---------------------------------------------------------------- controls
      for (const c of rows('controls').filter(mine)) {
        if (seen('control', c.id)) { add('controls', 'kept'); continue; }
        const tpl = c.template ? tplIds.get(c.template) ?? null : null;
        const [found] = await tx`
          SELECT id, status, owner_user_id, notes, na_rationale FROM controls WHERE tenant_id = ${tenant.id} AND key = ${c.key}`;
        if (found) {
          // A control nobody has touched here takes the hub's state; one already worked on stays.
          const untouched = found.status === 'not_started' && !found.owner_user_id && !found.notes && !found.na_rationale;
          if (untouched) {
            await tx`UPDATE controls SET status = ${c.status}, na_rationale = ${c.na_rationale}, notes = ${c.notes},
                       owner_user_id = ${user(c.owner_user_id)}, updated_at = ${c.updated_at}
                     WHERE id = ${found.id}`;
          }
          await remember('control', c.id, found.id); add('controls', 'matched');
          continue;
        }
        await tx`
          INSERT INTO controls (id, tenant_id, template_id, key, title, objective, owner_user_id, status, na_rationale, notes, created_at, updated_at)
          VALUES (${c.id}, ${tenant.id}, ${tpl}, ${c.key}, ${c.title}, ${c.objective}, ${user(c.owner_user_id)}, ${c.status},
                  ${c.na_rationale}, ${c.notes}, ${c.created_at}, ${c.updated_at})`;
        await remember('control', c.id, c.id); add('controls', 'added');
      }
      const control = (old) => ref('control', old);

      for (const m of rows('control_requirement_map')) {
        const cid = control(m.control_id);
        if (!cid) continue;
        const rid = reqIds.get(`${framework(m.framework, m.framework_version)}|${m.requirement}`);
        const [r] = await tx`
          INSERT INTO control_requirement_map (tenant_id, control_id, requirement_id, coverage, rationale)
          VALUES (${tenant.id}, ${cid}, ${rid}, ${m.coverage}, ${m.rationale})
          ON CONFLICT (control_id, requirement_id) DO NOTHING RETURNING control_id`;
        add('control mappings', r ? 'added' : 'kept');
      }

      // ---------------------------------------------------------------- evidence (append-only)
      for (const e of rows('evidence').filter(mine)) {
        if (seen('evidence', e.id)) { add('evidence', 'kept'); continue; }
        await tx`
          INSERT INTO evidence (id, tenant_id, control_id, kind, title, collected_at, collector, collector_version,
                                content_hash, content_type, storage_uri, payload, supersedes_id, created_at)
          VALUES (${e.id}, ${tenant.id}, ${control(e.control_id)}, ${e.kind}, ${e.title}, ${e.collected_at}, ${e.collector},
                  ${e.collector_version}, ${e.content_hash}, ${e.content_type}, ${e.storage_uri},
                  ${e.payload == null ? null : tx.json(e.payload)}, ${ref('evidence', e.supersedes_id)}, ${e.created_at})`;
        await remember('evidence', e.id, e.id); add('evidence', 'added');
      }

      // ---------------------------------------------------------------- agents and monitors
      for (const a of rows('agents').filter(mine)) {
        if (seen('agent', a.id)) { add('agents', 'kept'); continue; }
        const [found] = await tx`SELECT id FROM agents WHERE tenant_id = ${tenant.id} AND name = ${a.name}`;
        if (found) { await remember('agent', a.id, found.id); add('agents', 'matched'); continue; }
        // A revoked agent's token is not exported; its row needs some unique value, which no
        // token can hash to.
        await tx`
          INSERT INTO agents (id, tenant_id, name, host_label, token_hash, version, enabled, last_seen_at, last_report_at,
                              created_by, created_at, revoked_at)
          VALUES (${a.id}, ${tenant.id}, ${a.name}, ${a.host_label}, ${a.token_hash ?? `revoked:${a.id}`}, ${a.version},
                  ${a.enabled && !a.revoked_at}, ${a.last_seen_at}, ${a.last_report_at}, ${user(a.created_by)},
                  ${a.created_at}, ${a.revoked_at ?? (a.token_hash ? null : new Date().toISOString())})`;
        await remember('agent', a.id, a.id); add('agents', 'added');
      }

      for (const m of rows('monitors').filter(mine)) {
        if (seen('monitor', m.id)) { add('monitors', 'kept'); continue; }
        const [found] = await tx`SELECT id FROM monitors WHERE tenant_id = ${tenant.id} AND key = ${m.key}`;
        if (found) { await remember('monitor', m.id, found.id); add('monitors', 'matched'); continue; }
        await tx`
          INSERT INTO monitors (id, tenant_id, control_id, key, title, kind, config, schedule, severity, enabled, agent_id, created_at)
          VALUES (${m.id}, ${tenant.id}, ${control(m.control_id)}, ${m.key}, ${m.title}, ${m.kind}, ${tx.json(m.config ?? {})},
                  ${m.schedule}, ${m.severity}, ${m.enabled}, ${ref('agent', m.agent_id)}, ${m.created_at})`;
        await remember('monitor', m.id, m.id); add('monitors', 'added');
      }

      for (const r of rows('monitor_runs').filter(mine)) {
        if (seen('monitor_run', r.id)) { add('monitor runs', 'kept'); continue; }
        await tx`
          INSERT INTO monitor_runs (id, tenant_id, monitor_id, started_at, finished_at, status, message, observed, evidence_id, created_at)
          VALUES (${r.id}, ${tenant.id}, ${ref('monitor', r.monitor_id)}, ${r.started_at}, ${r.finished_at}, ${r.status},
                  ${r.message}, ${r.observed == null ? null : tx.json(r.observed)}, ${ref('evidence', r.evidence_id)}, ${r.created_at})`;
        await remember('monitor_run', r.id, r.id); add('monitor runs', 'added');
      }

      // ---------------------------------------------------------------- policies
      for (const p of rows('policies').filter(mine)) {
        if (seen('policy', p.id)) { add('policies', 'kept'); continue; }
        const [found] = await tx`SELECT id FROM policies WHERE tenant_id = ${tenant.id} AND key = ${p.key}`;
        if (found) { await remember('policy', p.id, found.id); add('policies', 'matched'); continue; }
        await tx`
          INSERT INTO policies (id, tenant_id, key, title, owner_user_id, status, review_cadence, review_due, created_at)
          VALUES (${p.id}, ${tenant.id}, ${p.key}, ${p.title}, ${user(p.owner_user_id)}, ${p.status}, ${p.review_cadence},
                  ${p.review_due}, ${p.created_at})`;
        await remember('policy', p.id, p.id); add('policies', 'added');
      }

      for (const v of rows('policy_versions').filter(mine)) {
        if (seen('policy_version', v.id)) { add('policy versions', 'kept'); continue; }
        const pid = ref('policy', v.policy_id);
        const [found] = await tx`SELECT id FROM policy_versions WHERE policy_id = ${pid} AND version = ${v.version}`;
        if (found) { await remember('policy_version', v.id, found.id); add('policy versions', 'matched'); continue; }
        await tx`
          INSERT INTO policy_versions (id, tenant_id, policy_id, version, body_md, content_hash, author_user_id, approved_by,
                                       approved_at, effective_at, created_at)
          VALUES (${v.id}, ${tenant.id}, ${pid}, ${v.version}, ${v.body_md}, ${v.content_hash}, ${user(v.author_user_id)},
                  ${user(v.approved_by)}, ${v.approved_at}, ${v.effective_at}, ${v.created_at})`;
        await remember('policy_version', v.id, v.id); add('policy versions', 'added');
      }

      for (const a of rows('policy_acknowledgements').filter(mine)) {
        const [r] = await tx`
          INSERT INTO policy_acknowledgements (id, tenant_id, policy_version_id, user_id, acknowledged_at)
          VALUES (${a.id}, ${tenant.id}, ${ref('policy_version', a.policy_version_id)}, ${user(a.user_id)}, ${a.acknowledged_at})
          ON CONFLICT DO NOTHING RETURNING id`;
        add('policy acknowledgements', r ? 'added' : 'kept');
      }

      // ---------------------------------------------------------------- risks
      for (const r of rows('risks').filter(mine)) {
        if (seen('risk', r.id)) { add('risks', 'kept'); continue; }
        const [found] = await tx`SELECT id FROM risks WHERE tenant_id = ${tenant.id} AND key = ${r.key}`;
        if (found) { await remember('risk', r.id, found.id); add('risks', 'matched'); continue; }
        await tx`
          INSERT INTO risks (id, tenant_id, key, title, description, category, likelihood, impact, treatment,
                             residual_likelihood, residual_impact, owner_user_id, status, review_due, created_at)
          VALUES (${r.id}, ${tenant.id}, ${r.key}, ${r.title}, ${r.description}, ${r.category}, ${r.likelihood}, ${r.impact},
                  ${r.treatment}, ${r.residual_likelihood}, ${r.residual_impact}, ${user(r.owner_user_id)}, ${r.status},
                  ${r.review_due}, ${r.created_at})`;
        await remember('risk', r.id, r.id); add('risks', 'added');
      }

      for (const m of rows('risk_control_map').filter(mine)) {
        const [r] = await tx`
          INSERT INTO risk_control_map (tenant_id, risk_id, control_id)
          VALUES (${tenant.id}, ${ref('risk', m.risk_id)}, ${control(m.control_id)})
          ON CONFLICT DO NOTHING RETURNING risk_id`;
        add('risk mappings', r ? 'added' : 'kept');
      }

      // ---------------------------------------------------------------- vendors, people, assets
      for (const v of rows('vendors').filter(mine)) {
        if (seen('vendor', v.id)) { add('vendors', 'kept'); continue; }
        const [found] = await tx`SELECT id FROM vendors WHERE tenant_id = ${tenant.id} AND lower(name) = lower(${v.name})`;
        if (found) { await remember('vendor', v.id, found.id); add('vendors', 'matched'); continue; }
        await tx`
          INSERT INTO vendors (id, tenant_id, name, category, criticality, processes_personal_data, processes_phi, is_subprocessor,
                               dpa_status, baa_status, assurance_report, review_due, owner_user_id, created_at)
          VALUES (${v.id}, ${tenant.id}, ${v.name}, ${v.category}, ${v.criticality}, ${v.processes_personal_data},
                  ${v.processes_phi}, ${v.is_subprocessor}, ${v.dpa_status}, ${v.baa_status}, ${v.assurance_report},
                  ${v.review_due}, ${user(v.owner_user_id)}, ${v.created_at})`;
        await remember('vendor', v.id, v.id); add('vendors', 'added');
      }

      for (const p of rows('personnel').filter(mine)) {
        if (seen('personnel', p.id)) { add('personnel', 'kept'); continue; }
        const [found] = await tx`SELECT id FROM personnel WHERE tenant_id = ${tenant.id} AND lower(email) = ${p.email}`;
        if (found) { await remember('personnel', p.id, found.id); add('personnel', 'matched'); continue; }
        await tx`
          INSERT INTO personnel (id, tenant_id, user_id, full_name, email, role_title, start_date, end_date, status,
                                 background_check_at, security_training_at, created_at)
          VALUES (${p.id}, ${tenant.id}, ${user(p.user_id)}, ${p.full_name}, ${p.email}, ${p.role_title}, ${p.start_date},
                  ${p.end_date}, ${p.status}, ${p.background_check_at}, ${p.security_training_at}, ${p.created_at})`;
        await remember('personnel', p.id, p.id); add('personnel', 'added');
      }

      for (const a of rows('assets').filter(mine)) {
        if (seen('asset', a.id)) { add('assets', 'kept'); continue; }
        const [found] = await tx`SELECT id FROM assets WHERE tenant_id = ${tenant.id} AND key = ${a.key}`;
        if (found) { await remember('asset', a.id, found.id); add('assets', 'matched'); continue; }
        await tx`
          INSERT INTO assets (id, tenant_id, key, name, kind, classification, owner_user_id, location, notes, created_at)
          VALUES (${a.id}, ${tenant.id}, ${a.key}, ${a.name}, ${a.kind}, ${a.classification}, ${user(a.owner_user_id)},
                  ${a.location}, ${a.notes}, ${a.created_at})`;
        await remember('asset', a.id, a.id); add('assets', 'added');
      }

      // ---------------------------------------------------------------- GDPR records and audits
      for (const p of rows('processing_activities').filter(mine)) {
        if (seen('processing_activity', p.id)) { add('processing activities', 'kept'); continue; }
        const [found] = await tx`SELECT id FROM processing_activities WHERE tenant_id = ${tenant.id} AND name = ${p.name}`;
        if (found) { await remember('processing_activity', p.id, found.id); add('processing activities', 'matched'); continue; }
        await tx`
          INSERT INTO processing_activities (id, tenant_id, name, purpose, lawful_basis, data_categories, special_category,
                                             data_subjects, recipients, retention, transfers_outside_eea, transfer_safeguard,
                                             dpia_required, dpia_ref, created_at)
          VALUES (${p.id}, ${tenant.id}, ${p.name}, ${p.purpose}, ${p.lawful_basis}, ${p.data_categories}::text[],
                  ${p.special_category}, ${p.data_subjects}::text[], ${p.recipients}::text[], ${p.retention},
                  ${p.transfers_outside_eea}, ${p.transfer_safeguard}, ${p.dpia_required}, ${p.dpia_ref}, ${p.created_at})`;
        await remember('processing_activity', p.id, p.id); add('processing activities', 'added');
      }

      for (const d of rows('dsar_requests').filter(mine)) {
        if (seen('dsar', d.id)) { add('data subject requests', 'kept'); continue; }
        await tx`
          INSERT INTO dsar_requests (id, tenant_id, subject_email, kind, received_at, due_at, status, refusal_reason, resolved_at, created_at)
          VALUES (${d.id}, ${tenant.id}, ${d.subject_email}, ${d.kind}, ${d.received_at}, ${d.due_at}, ${d.status},
                  ${d.refusal_reason}, ${d.resolved_at}, ${d.created_at})`;
        await remember('dsar', d.id, d.id); add('data subject requests', 'added');
      }

      for (const a of rows('audits').filter(mine)) {
        if (seen('audit', a.id)) { add('audits', 'kept'); continue; }
        await tx`
          INSERT INTO audits (id, tenant_id, framework_id, kind, period_start, period_end, auditor_firm, status, report_uri, created_at)
          VALUES (${a.id}, ${tenant.id}, ${framework(a.framework, a.framework_version)}, ${a.kind}, ${a.period_start},
                  ${a.period_end}, ${a.auditor_firm}, ${a.status}, ${a.report_uri}, ${a.created_at})`;
        await remember('audit', a.id, a.id); add('audits', 'added');
      }

      // ---------------------------------------------------------------- trust centre
      for (const t of rows('trust_centers').filter(mine)) {
        const [here] = await tx`SELECT tenant_id FROM trust_centers WHERE tenant_id = ${tenant.id}`;
        if (here) { add('trust centre', 'kept'); continue; }
        const [taken] = await tx`SELECT 1 FROM trust_centers WHERE public_slug = ${t.public_slug}`;
        if (taken) { log(`trust centre address ${t.public_slug} is taken here; set the trust centre up again`); continue; }
        await tx`
          INSERT INTO trust_centers (tenant_id, enabled, public_slug, headline, intro, security_contact, show_frameworks,
                                     show_control_counts, show_policies, show_subprocessors, updated_by, updated_at, created_at)
          VALUES (${tenant.id}, ${t.enabled}, ${t.public_slug}, ${t.headline}, ${t.intro}, ${t.security_contact},
                  ${t.show_frameworks}, ${t.show_control_counts}, ${t.show_policies}, ${t.show_subprocessors},
                  ${user(t.updated_by)}, ${t.updated_at}, ${t.created_at})`;
        for (const f of t.frameworks ?? []) {
          await tx`INSERT INTO trust_center_frameworks (tenant_id, framework_id) VALUES (${tenant.id}, ${framework(f.key, f.version)})
                   ON CONFLICT DO NOTHING`;
        }
        add('trust centre', 'added');
        if (t.enabled) log(`trust centre is public at /trust/${t.public_slug}`);
      }

      // ---------------------------------------------------------------- audit trail
      // Appended oldest first; the trigger gives each event its place in this tenant's chain.
      // object_id is rewritten only where the object landed under a different id here.
      const objectKinds = { control: 'control', monitor: 'monitor', policy: 'policy', risk: 'risk', vendor: 'vendor',
        asset: 'asset', user: 'user', evidence: 'evidence', agent: 'agent' };
      let appended = 0;
      for (const e of rows('audit_events').filter(mine)) {
        if (seen('audit_event', e.id)) { add('audit events', 'kept'); continue; }
        const kind = objectKinds[e.object_type];
        const objectId = (kind && e.object_id && seen(kind, e.object_id)) || e.object_id;
        const [r] = await tx`
          INSERT INTO audit_events (tenant_id, actor_user_id, actor_label, action, object_type, object_id, payload, created_at)
          VALUES (${tenant.id}, ${user(e.actor_user_id)}, ${e.actor_label}, ${e.action}, ${e.object_type}, ${objectId},
                  ${tx.json(e.payload ?? {})}, ${e.created_at})
          RETURNING id`;
        await remember('audit_event', e.id, r.id); add('audit events', 'added');
        appended++;
      }
      const chain = rows('audit_chains').find(mine);
      if (appended && chain) {
        await tx`
          INSERT INTO audit_events (tenant_id, actor_label, action, object_type, object_id, payload)
          VALUES (${tenant.id}, 'system:hub-import', 'hub.imported', 'tenant', ${tenant.id},
                  ${tx.json({
                    source: 'synergy-hub', hub_tenant: source.id, hub_slug: source.slug,
                    hub_events: Number(chain.events), hub_last_seq: chain.last_seq == null ? null : Number(chain.last_seq),
                    hub_last_hash: chain.last_hash, hub_chain_intact: chain.intact, appended,
                  })})`;
      }
      const broken = await tx`SELECT broken_at FROM verify_audit_chain(${tenant.id})`;
      if (broken.length) throw new Error(`the audit chain here does not verify at seq ${broken[0].broken_at}; nothing was imported`);
      if (chain && !chain.intact) log('note: the hub audit chain did not verify before the import (recorded in hub.imported)');

      // ---------------------------------------------------------------- sign-in history
      for (const e of rows('auth_events')) {
        if (seen('auth_event', e.id)) { add('sign-in history', 'kept'); continue; }
        const tenantId = e.tenant_id == null ? null : e.tenant_id === source.id ? tenant.id : null;
        if (e.tenant_id && !tenantId) continue;
        const [r] = await tx`
          INSERT INTO auth_events (at, event, email, user_id, tenant_id, ip, user_agent, detail)
          VALUES (${e.at}, ${e.event}, ${e.email}, ${user(e.user_id)}, ${tenantId}, ${e.ip}, ${e.user_agent},
                  ${tx.json({ ...(e.detail ?? {}), hub: true })})
          RETURNING id`;
        await remember('auth_event', e.id, r.id); add('sign-in history', 'added');
      }

      if (DRY) throw new DryRun();
    });
  } catch (e) {
    if (!(e instanceof DryRun)) throw e;
  }

  console.log('');
  for (const [k, c] of Object.entries(counts)) {
    const parts = [`${c.added} added`];
    if (c.matched) parts.push(`${c.matched} matched to what was here`);
    if (c.kept) parts.push(`${c.kept} already here`);
    console.log(`${k[0].toUpperCase()}${k.slice(1)}: ${parts.join(', ')}.`);
  }
  const left = ['passwords and second factors', 'sessions', 'recovery codes', 'invitations (memberships came across instead)'];
  console.log(`\nLeft behind: ${left.join(', ')}. People sign in through the suite.`);
  if (DRY) console.log('Dry run: everything was rolled back.');
}

main()
  .catch((e) => { console.error(e.message ?? e); process.exitCode = 1; })
  .finally(() => sql.end());
