// Seeds the global framework catalog and control library. Idempotent; runs on every start.
//
//   node scripts/seed.mjs                       catalog only
//   node scripts/seed.mjs --tenant example      also provision an example organisation
//
// THE TRAP THIS SCRIPT IS WRITTEN AGAINST: a mapping that references a requirement key
// which does not exist. An INSERT ... SELECT over a failed join inserts zero rows and
// exits cleanly, so a single typo in a requirement key silently drops that mapping and the
// coverage figure quietly understates - or, worse, a renamed key drops dozens and nothing
// reports it. So every mapping is resolved explicitly and an unresolved key is a hard
// failure, not a warning.

import { readFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { adminSql } from '../src/lib/db.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const catalogDir = join(here, '..', 'db', 'catalog');
const sql = adminSql({ max: 1 });

const load = async (f) => JSON.parse(await readFile(join(catalogDir, f), 'utf8'));

try {
  const frameworkFiles = ['soc2.json', 'iso27001.json', 'hipaa.json', 'gdpr.json'];

  // requirement lookup: 'frameworkKey|requirementKey' -> uuid
  const reqIds = new Map();

  for (const file of frameworkFiles) {
    const fw = await load(file);

    const [{ id: frameworkId }] = await sql`
      INSERT INTO frameworks (key, version, name, authority, description)
      VALUES (${fw.key}, ${fw.version}, ${fw.name}, ${fw.authority}, ${fw.description})
      ON CONFLICT (key, version) DO UPDATE
        SET name = EXCLUDED.name,
            authority = EXCLUDED.authority,
            description = EXCLUDED.description
      RETURNING id`;

    // Sections are inserted parents-first so parent_id always resolves. The catalog lists
    // them in that order; a forward reference is a catalog bug and should throw.
    const sectionIds = new Map();
    for (const s of fw.sections) {
      let parentId = null;
      if (s.parent) {
        parentId = sectionIds.get(s.parent);
        if (!parentId) {
          throw new Error(
            `${file}: section ${s.key} names parent ${s.parent}, which is not defined above it`,
          );
        }
      }
      const [{ id }] = await sql`
        INSERT INTO framework_sections
          (framework_id, parent_id, key, title, kind, selectable, ordinal)
        VALUES (${frameworkId}, ${parentId}, ${s.key}, ${s.title}, ${s.kind},
                ${s.selectable ?? false}, ${s.ordinal ?? 0})
        ON CONFLICT (framework_id, key) DO UPDATE
          SET title = EXCLUDED.title, kind = EXCLUDED.kind,
              selectable = EXCLUDED.selectable, ordinal = EXCLUDED.ordinal
        RETURNING id`;
      sectionIds.set(s.key, id);
    }

    for (const r of fw.requirements) {
      const sectionId = sectionIds.get(r.section);
      if (!sectionId) {
        throw new Error(`${file}: requirement ${r.key} references unknown section ${r.section}`);
      }
      const [{ id }] = await sql`
        INSERT INTO requirements
          (framework_id, section_id, key, title, text, obligation, guidance, ordinal)
        VALUES (${frameworkId}, ${sectionId}, ${r.key}, ${r.title}, ${r.text},
                ${r.obligation ?? 'required'}, ${r.guidance ?? null}, ${r.ordinal ?? 0})
        ON CONFLICT (framework_id, key) DO UPDATE
          SET title = EXCLUDED.title, text = EXCLUDED.text,
              obligation = EXCLUDED.obligation, guidance = EXCLUDED.guidance,
              section_id = EXCLUDED.section_id, ordinal = EXCLUDED.ordinal
        RETURNING id`;
      reqIds.set(`${fw.key}|${r.key}`, id);
    }

    console.log(
      `  ${fw.key.padEnd(10)} ${String(fw.sections.length).padStart(3)} sections, ` +
        `${String(fw.requirements.length).padStart(3)} requirements`,
    );
  }

  // --- control library -----------------------------------------------------

  const lib = await load('controls.json');
  const unresolved = [];
  let mappingCount = 0;

  for (const t of lib.templates) {
    const [{ id: templateId }] = await sql`
      INSERT INTO control_templates (key, title, objective, category, guidance)
      VALUES (${t.key}, ${t.title}, ${t.objective}, ${t.category}, ${t.guidance ?? null})
      ON CONFLICT (key) DO UPDATE
        SET title = EXCLUDED.title, objective = EXCLUDED.objective,
            category = EXCLUDED.category, guidance = EXCLUDED.guidance
      RETURNING id`;

    for (const [fwKey, reqKey, coverage, rationale] of t.maps) {
      const requirementId = reqIds.get(`${fwKey}|${reqKey}`);
      if (!requirementId) {
        unresolved.push(`${t.key} -> ${fwKey}:${reqKey}`);
        continue;
      }
      await sql`
        INSERT INTO control_template_requirement_map
          (template_id, requirement_id, coverage, rationale)
        VALUES (${templateId}, ${requirementId}, ${coverage}, ${rationale})
        ON CONFLICT (template_id, requirement_id) DO UPDATE
          SET coverage = EXCLUDED.coverage, rationale = EXCLUDED.rationale`;
      mappingCount++;
    }
  }

  if (unresolved.length) {
    throw new Error(
      `controls.json references ${unresolved.length} requirement(s) that do not exist ` +
        `in any seeded framework:\n    ${unresolved.join('\n    ')}\n` +
        `  Every mapping must resolve - a dropped mapping understates coverage silently.`,
    );
  }

  console.log(
    `  controls   ${String(lib.templates.length).padStart(3)} templates, ` +
      `${mappingCount} framework mappings`,
  );

  // --- optional example tenant ---------------------------------------------
  //
  // A real deployment creates its first organisation when the first suite user arrives
  // (see src/lib/identity.ts). `--tenant <slug> [name]` provisions one up front, which the
  // verification suites and local development use.

  const ti = process.argv.indexOf('--tenant');
  if (ti !== -1) {
    const slug = process.argv[ti + 1];
    const name = process.argv[ti + 2] && !process.argv[ti + 2].startsWith('--')
      ? process.argv[ti + 2]
      : 'Example Organisation';
    if (!slug) throw new Error('--tenant needs a slug, e.g. --tenant example');
    // The function sets app.tenant_id for this transaction, so the count sees the new rows.
    const controls = await sql.begin(async (tx) => {
      const [{ id }] = await tx`SELECT trust_provision_tenant(${slug}, ${name}) AS id`;
      const [{ n }] = await tx`SELECT count(*)::int AS n FROM controls WHERE tenant_id = ${id}`;
      return n;
    });
    console.log(`\n  tenant '${slug}': ${controls} controls, SOC 2 Common Criteria in scope`);
  }

  console.log('\nSeed complete.');
} catch (err) {
  console.error('\nSeed failed:', err.message);
  process.exitCode = 1;
} finally {
  await sql.end();
}
