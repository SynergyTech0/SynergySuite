import { json, formBody } from '@/lib/http';
import { currentUser } from '@/lib/session';
import { q, now } from '@/lib/db';
import { createClient, type Client } from '@/lib/oauth';
import { audit } from '@/lib/audit';

async function requireAdmin(req: Request) {
  const auth = await currentUser(req);
  if (!auth || auth.user.role !== 'admin') return null;
  return auth;
}

export async function GET(req: Request) {
  const auth = await requireAdmin(req);
  if (!auth) return json({ error: 'forbidden' }, 403);
  const rows = await q<Client>(`SELECT * FROM sa_clients ORDER BY id LIMIT $1`, [200]);
  return json({
    clients: rows.map((c) => ({
      id: String(c.id), client_id: c.client_id, name: c.name,
      redirect_uris: c.redirect_uris, grant_types: c.grant_types, scopes: c.scopes,
      first_party: Number(c.first_party) !== 0, public_client: Number(c.public_client) !== 0,
      disabled: Number(c.disabled) !== 0,
    })),
  });
}

export async function POST(req: Request) {
  const auth = await requireAdmin(req);
  if (!auth) return json({ error: 'forbidden' }, 403);
  const body = await formBody(req);
  const action = body.get('action') ?? 'create';

  if (action === 'create') {
    const name = body.get('name') ?? '';
    const redirectUris = (body.get('redirect_uris') ?? '').split(/[\n,\s]+/).filter(Boolean);
    if (!name || redirectUris.length === 0) return json({ error: 'name and redirect_uris required' }, 400);
    for (const u of redirectUris) {
      try { new URL(u); } catch { return json({ error: `invalid redirect_uri: ${u}` }, 400); }
    }
    const grantTypes = ['authorization_code', 'refresh_token'];
    if (body.get('client_credentials') === '1') grantTypes.push('client_credentials');
    const { client, clientSecret } = await createClient({
      name, redirectUris,
      postLogoutUris: (body.get('post_logout_uris') ?? '').split(/[\n,\s]+/).filter(Boolean),
      grantTypes,
      firstParty: body.get('first_party') === '1',
      publicClient: body.get('public_client') === '1',
    });
    await audit('admin.client_created', auth.user.email, { client_id: client.client_id, name }, req);
    // Secret is shown exactly once (Auth0-style) — only the bcrypt hash is stored.
    return json({ ok: true, client_id: client.client_id, client_secret: clientSecret });
  }

  const clientId = body.get('client_id') ?? '';
  if (action === 'disable' || action === 'enable') {
    await q(`UPDATE sa_clients SET disabled = $2::bigint WHERE client_id = $1::text`, [
      clientId, action === 'disable' ? 1 : 0,
    ]);
    if (action === 'disable') {
      await q(`UPDATE sa_refresh_tokens SET revoked = 1::bigint WHERE client_id = $1::text`, [clientId]);
    }
    await audit(`admin.client_${action}d`, auth.user.email, { client_id: clientId }, req);
    return json({ ok: true });
  }

  return json({ error: 'unknown_action' }, 400);
}
