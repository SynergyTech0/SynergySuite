import { randomBytes } from 'crypto';
import { json, formBody } from '@/lib/http';
import { currentUser } from '@/lib/session';
import { q, now } from '@/lib/db';
import { rotateKey } from '@/lib/keys';
import { sha256hex } from '@/lib/oauth';
import { audit } from '@/lib/audit';

/* Admin settings: signing-key rotation, SCIM API tokens, SAML SP registry. */

async function requireAdmin(req: Request) {
  const auth = await currentUser(req);
  if (!auth || auth.user.role !== 'admin') return null;
  return auth;
}

export async function GET(req: Request) {
  const auth = await requireAdmin(req);
  if (!auth) return json({ error: 'forbidden' }, 403);
  const keys = await q<{ kid: string; active: string | number; created_ms: string | number }>(
    `SELECT kid, active, created_ms FROM sa_keys ORDER BY created_ms DESC LIMIT $1`, [10],
  );
  const tokens = await q<{ token_hash: string; name: string; revoked: string | number; created_ms: string | number }>(
    `SELECT * FROM sa_api_tokens ORDER BY created_ms DESC LIMIT $1`, [50],
  );
  const sps = await q<{ id: string; entity_id: string; acs_url: string; slo_url: string | null; name: string }>(
    `SELECT * FROM sa_saml_sps ORDER BY id LIMIT $1`, [50],
  );
  return json({
    keys: keys.map((k) => ({ kid: k.kid, active: Number(k.active) !== 0, created_ms: Number(k.created_ms) })),
    api_tokens: tokens.map((t) => ({ hash8: t.token_hash.slice(0, 8), name: t.name, revoked: Number(t.revoked) !== 0 })),
    saml_sps: sps.map((s) => ({ id: String(s.id), entity_id: s.entity_id, acs_url: s.acs_url, slo_url: s.slo_url, name: s.name })),
  });
}

export async function POST(req: Request) {
  const auth = await requireAdmin(req);
  if (!auth) return json({ error: 'forbidden' }, 403);
  const body = await formBody(req);
  const action = body.get('action') ?? '';

  if (action === 'rotate_key') {
    const kid = await rotateKey();
    await audit('admin.key_rotated', auth.user.email, { new_kid: kid }, req);
    return json({ ok: true, kid });
  }

  if (action === 'create_api_token') {
    const name = body.get('name') || 'scim';
    const token = 'sascim_' + randomBytes(24).toString('base64url');
    await q(
      `INSERT INTO sa_api_tokens (token_hash, name, created_ms) VALUES ($1::text, $2::text, $3::bigint)`,
      [sha256hex(token), name, now()],
    );
    await audit('admin.api_token_created', auth.user.email, { name }, req);
    return json({ ok: true, token }); // shown once
  }

  if (action === 'revoke_api_token') {
    const hash8 = body.get('hash8') ?? '';
    const rows = await q<{ token_hash: string }>(`SELECT token_hash FROM sa_api_tokens LIMIT $1`, [200]);
    for (const r of rows) {
      if (r.token_hash.startsWith(hash8)) {
        await q(`UPDATE sa_api_tokens SET revoked = 1::bigint WHERE token_hash = $1::text`, [r.token_hash]);
      }
    }
    await audit('admin.api_token_revoked', auth.user.email, { hash8 }, req);
    return json({ ok: true });
  }

  if (action === 'add_saml_sp') {
    const entityId = body.get('entity_id') ?? '';
    const acsUrl = body.get('acs_url') ?? '';
    const sloUrl = body.get('slo_url') ?? '';
    const name = body.get('name') || entityId;
    if (!entityId || !acsUrl) return json({ error: 'entity_id and acs_url required' }, 400);
    try { new URL(acsUrl); } catch { return json({ error: 'invalid acs_url' }, 400); }
    if (sloUrl) { try { new URL(sloUrl); } catch { return json({ error: 'invalid slo_url' }, 400); } }
    await q(
      `INSERT INTO sa_saml_sps (entity_id, acs_url, slo_url, name, created_ms) VALUES ($1::text, $2::text, $3::text, $4::text, $5::bigint)`,
      [entityId, acsUrl, sloUrl || null, name, now()],
    );
    await audit('admin.saml_sp_added', auth.user.email, { entity_id: entityId }, req);
    return json({ ok: true });
  }

  if (action === 'delete_saml_sp') {
    await q(`DELETE FROM sa_saml_sps WHERE id + 0 = $1::bigint`, [body.get('sp_id') ?? '0']);
    await audit('admin.saml_sp_deleted', auth.user.email, { id: body.get('sp_id') }, req);
    return json({ ok: true });
  }

  return json({ error: 'unknown_action' }, 400);
}
