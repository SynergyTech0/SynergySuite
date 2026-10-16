// Builds the asset inventory from the estate as it actually is.
//
//   node scripts/import-assets.mjs --hosts hosts.json [--apply] [--out sweep.json] <tenant-slug>
//   node scripts/import-assets.mjs --host web-1 --host db-1 [--public example.com] <tenant-slug>
//   node scripts/import-assets.mjs --from sweep.json --apply <tenant-slug>
//
// The host list is yours to supply, either as repeated --host arguments or as a JSON file:
//   { "hosts":  [{ "alias": "web-1", "label": "web-1 (203.0.113.10)" }],
//     "public": ["example.com", "www.example.com"] }
// `alias` is what `ssh` connects to (an ~/.ssh/config entry works, including a ProxyJump);
// `public` lists the hostnames that are deliberately public and classified as such.
//
// WHY THIS ENUMERATES RATHER THAN ACCEPTS A LIST
//
// An inventory typed from memory records what someone believes is running. The gap between
// that and what IS running is precisely where unprotected systems live — and ISO A.5.9 and
// the HIPAA risk analysis both turn on the inventory being complete, not plausible. So this
// reads the live estate: web server vhosts (nginx sites-enabled) for the public surface, and
// running Docker containers for the databases.
//
// Classification is applied by rule and marked PROVISIONAL. Classifying data is a judgement
// about what the system holds, and nothing here can see inside a database. The rules get the
// obvious cases right and the notes say plainly that a human has to confirm the rest —
// which is a far more useful starting point than 100 assets all marked "internal".

import { spawn } from 'node:child_process';
import { writeFileSync, readFileSync } from 'node:fs';
import { adminSql } from '../src/lib/db.mjs';
import { suggestsPhi } from '../src/lib/phi-names.mjs';

const args = process.argv.slice(2);
const APPLY = args.includes('--apply');
const OUT = args.includes('--out') ? args[args.indexOf('--out') + 1] : null;
const FROM = args.includes('--from') ? args[args.indexOf('--from') + 1] : null;
const VALUE_FLAGS = new Set(['--out', '--from', '--hosts', '--host', '--public']);
const slug = args.find((a, i) => !a.startsWith('--') && !VALUE_FLAGS.has(args[i - 1]));
const values = (flag) => args.flatMap((a, i) => (a === flag && args[i + 1] ? [args[i + 1]] : []));

if (!slug) {
  console.error('Name the organisation: node scripts/import-assets.mjs --hosts hosts.json <tenant-slug>');
  process.exit(2);
}

// Discovery needs SSH to the hosts; the database may live elsewhere. Splitting the two
// (--out, then --from) lets the sweep run wherever the access is and the write happen
// wherever the data belongs, rather than requiring one machine to hold both.
const config = args.includes('--hosts')
  ? JSON.parse(readFileSync(args[args.indexOf('--hosts') + 1], 'utf8'))
  : { hosts: [], public: [] };
const HOSTS = [
  ...(config.hosts ?? []).map((h) => ({ alias: String(h.alias), label: String(h.label ?? h.alias) })),
  ...values('--host').map((alias) => ({ alias, label: alias })),
];
const PUBLIC = new Set([...(config.public ?? []), ...values('--public')].map((n) => String(n).toLowerCase()));

if (!FROM && HOSTS.length === 0) {
  console.error('No hosts to sweep. Pass --hosts <file.json>, one or more --host <alias>, or --from <sweep.json>.');
  process.exit(2);
}

function ssh(alias, command) {
  return new Promise((resolve) => {
    const child = spawn('ssh', ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=15', alias, command], {
      windowsHide: true,
    });
    let out = '';
    const timer = setTimeout(() => {
      child.kill();
      resolve({ ok: false, out: '' });
    }, 60_000);
    child.stdout.on('data', (d) => (out += d));
    child.on('error', () => {
      clearTimeout(timer);
      resolve({ ok: false, out: '' });
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ ok: code === 0, out });
    });
  });
}

// Rule-based, provisional, and conservative where it matters.
function classify(name, kind) {
  const n = name.toLowerCase();
  // Anything that touches PHI is restricted. Over-classifying an EMR costs a review;
  // under-classifying one is a HIPAA finding.
  // The pattern lives in src/lib/phi-names.mjs because asset-inventory.mjs flags the
  // inverse case and the two must agree. A PHI system classified as merely internal is
  // worse than an unowned one: it looks handled, so its safeguards are never scoped.
  if (suggestsPhi(n)) return 'restricted';
  if (/vault|secret|auth|pay|billing|bill|invoice|finance|stripe|bank/.test(n)) return 'confidential';
  if (kind === 'database') return 'confidential';
  // Hostnames listed as public in the config are deliberately public; everything else
  // defaults to internal.
  if (PUBLIC.has(n)) return 'public';
  return 'internal';
}

const sql = adminSql({ max: 1 });

try {
  const [tenant] = await sql`SELECT id, name FROM tenants WHERE slug = ${slug}`;
  if (!tenant) throw new Error(`no tenant with slug '${slug}'`);

  const assets = new Map();
  const unreachable = [];

  if (FROM) {
    const payload = JSON.parse(readFileSync(FROM, 'utf8'));
    for (const a of payload.assets) assets.set(a.key, a);
    unreachable.push(...(payload.unreachable ?? []));
    console.log(`
  loaded ${assets.size} assets from ${FROM} (discovered ${payload.discovered_at})`);
  }

  for (const host of FROM ? [] : HOSTS) {
    // Public endpoints: every enabled nginx vhost.
    const vhosts = await ssh(host.alias, "ls /etc/nginx/sites-enabled/ 2>/dev/null");
    if (!vhosts.ok) {
      unreachable.push(host.label);
      continue;
    }
    for (const name of vhosts.out.split('\n').map((x) => x.trim()).filter(Boolean)) {
      if (name === 'default' || !name.includes('.')) continue;
      assets.set(`endpoint:${name}`, {
        key: `endpoint:${name}`,
        name,
        kind: 'endpoint',
        classification: classify(name, 'endpoint'),
        location: host.label,
        notes: 'Public HTTPS surface, discovered from nginx sites-enabled.',
      });
    }

    // Databases: every running container on a database image.
    const dbs = await ssh(
      host.alias,
      "docker ps --format '{{.Names}}|{{.Image}}' 2>/dev/null | grep -iE 'postgres|pgvector|mysql|mariadb|mongo|redis|clickhouse' || true",
    );
    for (const line of dbs.out.split('\n').map((x) => x.trim()).filter(Boolean)) {
      const [cname, image] = line.split('|');
      if (!cname) continue;
      // Caches hold session and queue data, which is still in scope but is not a system of
      // record. Recorded with its own kind so it can be treated differently.
      const kind = /redis|memcached/i.test(image) ? 'cache' : 'database';
      assets.set(`db:${cname}`, {
        key: `db:${cname}`,
        name: cname,
        kind,
        classification: classify(cname, kind),
        location: `${host.label} · ${image}`,
        notes: `Discovered from running containers. Image ${image}.`,
      });
    }

    assets.set(`host:${host.alias}`, {
      key: `host:${host.alias}`,
      name: host.label,
      kind: 'host',
      classification: 'confidential',
      location: host.label,
      notes: 'Host running application and database workloads.',
    });
  }

  const byKind = {};
  const byClass = {};
  for (const a of assets.values()) {
    byKind[a.kind] = (byKind[a.kind] ?? 0) + 1;
    byClass[a.classification] = (byClass[a.classification] ?? 0) + 1;
  }

  console.log(`\nDiscovered ${assets.size} assets across ${HOSTS.length - unreachable.length} host(s)\n`);
  console.log('  by kind : ' + Object.entries(byKind).map(([k, n]) => `${k} ${n}`).join(', '));
  console.log('  by class: ' + Object.entries(byClass).map(([k, n]) => `${k} ${n}`).join(', '));
  if (unreachable.length) {
    // Stated loudly: an inventory built from a partial sweep is not an inventory, and the
    // gap has to travel with the number.
    console.log(`\n  INCOMPLETE — could not reach: ${unreachable.join(', ')}`);
  }

  if (OUT) {
    writeFileSync(OUT, JSON.stringify({
      discovered_at: new Date().toISOString(),
      discovered: assets.size,
      unreachable,
      assets: [...assets.values()],
    }, null, 2));
    console.log(`
  written to ${OUT}
`);
  }

  if (!APPLY) {
    console.log('\n  (dry run — re-run with --apply to write)\n');
    const sample = [...assets.values()].slice(0, 8);
    for (const a of sample) {
      console.log(`    ${a.kind.padEnd(9)} ${a.classification.padEnd(12)} ${a.name}`);
    }
    console.log(`    … and ${assets.size - sample.length} more\n`);
  } else {
    let inserted = 0;
    let updated = 0;
    for (const a of assets.values()) {
      const [row] = await sql`
        INSERT INTO assets (tenant_id, key, name, kind, classification, location, notes)
        VALUES (${tenant.id}, ${a.key}, ${a.name}, ${a.kind}, ${a.classification},
                ${a.location}, ${a.notes})
        ON CONFLICT (tenant_id, key) DO UPDATE
          SET name = EXCLUDED.name, kind = EXCLUDED.kind, location = EXCLUDED.location,
              notes = EXCLUDED.notes
        RETURNING (xmax = 0) AS was_insert`;
      if (row.was_insert) inserted++;
      else updated++;
    }
    // Classification is NOT overwritten on update: once a person has reviewed and set it,
    // a rule must not silently undo that decision on the next sweep.
    await sql`
      INSERT INTO audit_events (tenant_id, actor_label, action, object_type, object_id, payload)
      VALUES (${tenant.id}, 'operator:import-assets', 'asset.imported', 'asset', 'bulk',
              ${sql.json({ discovered: assets.size, inserted, updated, unreachable })})`;
    console.log(`\n  ${inserted} inserted, ${updated} updated.`);
    console.log('  Classification is provisional and is NOT overwritten on re-import —');
    console.log('  a human decision, once made, survives the next sweep.\n');
  }
} catch (err) {
  console.error('\nImport failed:', err.message);
  process.exitCode = 1;
} finally {
  await sql.end();
}
