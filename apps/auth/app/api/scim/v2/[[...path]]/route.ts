import { NextRequest } from 'next/server';
import { q, now } from '@/lib/db';
import { sha256hex } from '@/lib/oauth';
import { createUser, findByEmail, setPassword, type User } from '@/lib/users';
import { audit } from '@/lib/audit';

/*
 * SCIM 2.0 (RFC 7644) — Users resource, the subset Okta/Entra provisioning
 * actually uses: list w/ userName-eq filter + pagination, get, create, replace,
 * patch (active/password), delete (= disable). Bearer auth via sa_api_tokens.
 */

const SCIM_USER = 'urn:ietf:params:scim:schemas:core:2.0:User';
const SCIM_LIST = 'urn:ietf:params:scim:api:messages:2.0:ListResponse';
const SCIM_ERROR = 'urn:ietf:params:scim:api:messages:2.0:Error';
const SCIM_PATCH = 'urn:ietf:params:scim:api:messages:2.0:PatchOp';

const scim = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/scim+json' } });

const scimError = (status: number, detail: string) =>
  scim({ schemas: [SCIM_ERROR], status: String(status), detail }, status);

async function authed(req: Request): Promise<boolean> {
  const h = req.headers.get('authorization') ?? '';
  if (!h.startsWith('Bearer sascim_')) return false;
  const rows = await q<{ revoked: string | number }>(
    `SELECT revoked FROM sa_api_tokens WHERE token_hash = $1::text`, [sha256hex(h.slice(7))],
  );
  return rows.length > 0 && Number(rows[0].revoked) === 0;
}

function toScimUser(u: User): Record<string, unknown> {
  return {
    schemas: [SCIM_USER],
    id: String(u.id),
    userName: u.email,
    name: { formatted: u.name ?? u.email },
    emails: [{ value: u.email, primary: true }],
    active: Number(u.disabled) === 0,
    meta: { resourceType: 'User', created: new Date(Number(u.created_ms)).toISOString() },
  };
}

async function getUser(id: string): Promise<User | null> {
  const rows = await q<User>(`SELECT * FROM sa_users WHERE id + 0 = $1::bigint`, [id]);
  return rows[0] ?? null;
}

async function setActive(id: string, active: boolean) {
  await q(`UPDATE sa_users SET disabled = $2::bigint, updated_ms = $3::bigint WHERE id + 0 = $1::bigint`, [
    id, active ? 0 : 1, now(),
  ]);
  if (!active) {
    await q(`UPDATE sa_sessions SET revoked = 1::bigint WHERE user_id = $1::bigint`, [id]);
    await q(`UPDATE sa_refresh_tokens SET revoked = 1::bigint WHERE user_id = $1::bigint`, [id]);
  }
}

function parts(req: NextRequest): string[] {
  // /api/scim/v2/<...> — everything after v2
  return req.nextUrl.pathname.split('/').filter(Boolean).slice(3);
}

export async function GET(req: NextRequest) {
  const p = parts(req);
  if (p[0] === 'ServiceProviderConfig') {
    return scim({
      schemas: ['urn:ietf:params:scim:schemas:core:2.0:ServiceProviderConfig'],
      patch: { supported: true },
      bulk: { supported: false },
      filter: { supported: true, maxResults: 200 },
      changePassword: { supported: true },
      sort: { supported: false },
      etag: { supported: false },
      authenticationSchemes: [{ type: 'oauthbearertoken', name: 'Bearer token', description: 'SCIM API token from the SynergyAuth admin console' }],
    });
  }
  if (!(await authed(req))) return scimError(401, 'Invalid or missing bearer token');

  if (p[0] === 'Users' && !p[1]) {
    const filter = req.nextUrl.searchParams.get('filter');
    const startIndex = Math.max(1, Number(req.nextUrl.searchParams.get('startIndex') ?? 1));
    const count = Math.min(200, Number(req.nextUrl.searchParams.get('count') ?? 100));
    let users: User[];
    const m = filter?.match(/^userName\s+eq\s+"(.+)"$/i);
    if (m) {
      const u = await findByEmail(m[1]);
      users = u ? [u] : [];
    } else {
      users = await q<User>(`SELECT * FROM sa_users ORDER BY id LIMIT $1`, [500]);
    }
    const page = users.slice(startIndex - 1, startIndex - 1 + count);
    return scim({
      schemas: [SCIM_LIST],
      totalResults: users.length,
      startIndex,
      itemsPerPage: page.length,
      Resources: page.map(toScimUser),
    });
  }

  if (p[0] === 'Users' && p[1]) {
    const u = await getUser(p[1]);
    return u ? scim(toScimUser(u)) : scimError(404, 'User not found');
  }

  return scimError(404, 'Unsupported SCIM resource');
}

export async function POST(req: NextRequest) {
  if (!(await authed(req))) return scimError(401, 'Invalid or missing bearer token');
  const p = parts(req);
  if (p[0] !== 'Users' || p[1]) return scimError(404, 'Unsupported SCIM resource');

  const body = await req.json().catch(() => null);
  if (!body?.userName) return scimError(400, 'userName is required');
  if (await findByEmail(body.userName)) return scimError(409, 'User already exists');

  const password = body.password ?? 'Scim-' + sha256hex(String(Math.random())).slice(0, 12) + '1a';
  const user = await createUser({
    email: body.userName,
    name: body.name?.formatted ?? body.displayName,
    password,
    role: 'user',
  });
  if (body.active === false) await setActive(String(user.id), false);
  await audit('scim.user_created', 'scim', { email: body.userName }, req);
  const fresh = await getUser(String(user.id));
  return scim(toScimUser(fresh!), 201);
}

export async function PUT(req: NextRequest) {
  if (!(await authed(req))) return scimError(401, 'Invalid or missing bearer token');
  const p = parts(req);
  if (p[0] !== 'Users' || !p[1]) return scimError(404, 'Unsupported SCIM resource');
  const u = await getUser(p[1]);
  if (!u) return scimError(404, 'User not found');

  const body = await req.json().catch(() => ({}));
  const name = body.name?.formatted ?? body.displayName ?? u.name;
  await q(`UPDATE sa_users SET name = $2::text, updated_ms = $3::bigint WHERE id + 0 = $1::bigint`, [u.id, name, now()]);
  if (typeof body.active === 'boolean') await setActive(String(u.id), body.active);
  if (body.password) await setPassword(u.id, body.password);
  await audit('scim.user_replaced', 'scim', { id: String(u.id) }, req);
  return scim(toScimUser((await getUser(String(u.id)))!));
}

export async function PATCH(req: NextRequest) {
  if (!(await authed(req))) return scimError(401, 'Invalid or missing bearer token');
  const p = parts(req);
  if (p[0] !== 'Users' || !p[1]) return scimError(404, 'Unsupported SCIM resource');
  const u = await getUser(p[1]);
  if (!u) return scimError(404, 'User not found');

  const body = await req.json().catch(() => ({}));
  if (!Array.isArray(body.Operations)) return scimError(400, `Expected ${SCIM_PATCH} Operations`);
  for (const op of body.Operations) {
    const opName = String(op.op ?? '').toLowerCase();
    if (opName !== 'replace' && opName !== 'add') continue;
    const value = op.path ? { [op.path]: op.value } : op.value;
    if (typeof value?.active === 'boolean') await setActive(String(u.id), value.active);
    if (typeof value?.active === 'string') await setActive(String(u.id), value.active.toLowerCase() === 'true');
    if (value?.password) await setPassword(u.id, value.password);
    if (value?.['name.formatted']) {
      await q(`UPDATE sa_users SET name = $2::text WHERE id + 0 = $1::bigint`, [u.id, value['name.formatted']]);
    }
  }
  await audit('scim.user_patched', 'scim', { id: String(u.id) }, req);
  return scim(toScimUser((await getUser(String(u.id)))!));
}

export async function DELETE(req: NextRequest) {
  if (!(await authed(req))) return scimError(401, 'Invalid or missing bearer token');
  const p = parts(req);
  if (p[0] !== 'Users' || !p[1]) return scimError(404, 'Unsupported SCIM resource');
  const u = await getUser(p[1]);
  if (!u) return scimError(404, 'User not found');
  // SCIM delete = deprovision. Disable rather than destroy (audit trail survives).
  await setActive(String(u.id), false);
  await audit('scim.user_deleted', 'scim', { id: String(u.id) }, req);
  return new Response(null, { status: 204 });
}
