// The request-scoped session: the suite identity, its Trust memberships, and the
// organisation this request acts in.
//
// There is no Trust login and no Trust session row. The suite gateway signs people in and
// passes their identity on every request (see @synergy/identity); each request resolves it
// to a Trust user and re-reads that user's memberships, so a removed membership or a changed
// role takes effect on the very next request.
//
// The organisation a person is working in is remembered in a cookie. The cookie only
// chooses between memberships the database confirms on every request; a cookie naming an
// organisation the person does not belong to is ignored.

import { cache } from 'react';
import { cookies, headers } from 'next/headers';
import { identify } from '@synergy/identity';
import { resolveSuiteUser, isReadOnly, type Membership, type Role } from './auth';

export const TENANT_COOKIE = 'trust_tenant';

/** A session that may use the app: a member of the organisation it is acting in. */
export type ReadySession = {
  userId: string;
  userEmail: string;
  userName: string;
  tenantId: string;
  tenantSlug: string;
  tenantName: string;
  role: Role;
  readOnly: boolean;
  memberships: Membership[];
};

export type Access =
  | { state: 'anonymous' }
  | { state: 'no_access'; email: string; suspended: boolean }
  | { state: 'ready'; session: ReadySession };

/** No suite identity on the request: it did not come through the gateway signed in. */
export class NoSessionError extends Error {
  constructor(message = 'Not signed in.') {
    super(message);
    this.name = 'NoSessionError';
  }
}

/** Signed in to the suite, but not a member of any Trust organisation. */
export class NoAccessError extends Error {
  constructor(
    readonly email: string,
    message = 'You are not a member of any organisation in Trust. Ask an administrator to add you.',
  ) {
    super(message);
    this.name = 'NoAccessError';
  }
}

export class ForbiddenError extends Error {}

export async function requestContext() {
  const h = await headers();
  return {
    // x-forwarded-for is attacker-controllable unless a trusted proxy sets it. It is
    // recorded for the audit trail, never used for an authorisation decision.
    ip: h.get('x-forwarded-for')?.split(',')[0]?.trim() ?? null,
    userAgent: h.get('user-agent') ?? null,
    origin: h.get('origin'),
    host: h.get('host'),
  };
}

/**
 * Who is making this request and what they may do. Memoised per request, so a layout and
 * the page beneath it resolve the identity once.
 */
export const currentAccess = cache(async (): Promise<Access> => {
  const h = await headers();
  const identity = identify(h);
  if (!identity) return { state: 'anonymous' };

  const ctx = await requestContext();
  const { user, memberships } = await resolveSuiteUser(
    { email: identity.email, name: identity.name },
    { ip: ctx.ip, userAgent: ctx.userAgent },
  );
  if (!memberships.length) {
    return { state: 'no_access', email: user.email, suspended: user.status === 'suspended' };
  }

  const chosen = (await cookies()).get(TENANT_COOKIE)?.value;
  const m = memberships.find((x) => x.tenantId === chosen) ?? memberships[0];
  return {
    state: 'ready',
    session: {
      userId: user.id,
      userEmail: user.email,
      userName: user.name,
      tenantId: m.tenantId,
      tenantSlug: m.slug,
      tenantName: m.name,
      role: m.role,
      readOnly: isReadOnly(m.role),
      memberships,
    },
  };
});

/** The current session, or throws NoSessionError / NoAccessError. */
export async function requireSession(): Promise<ReadySession> {
  const access = await currentAccess();
  if (access.state === 'anonymous') throw new NoSessionError();
  if (access.state === 'no_access') throw new NoAccessError(access.email);
  return access.session;
}

/** Throws unless the session may write. Auditor and viewer seats are read-only. */
export function requireWrite(s: ReadySession): void {
  if (s.readOnly) {
    throw new ForbiddenError(
      `The ${s.role} role is read-only. Ask an administrator for a contributor seat.`,
    );
  }
}

export function requireAdmin(s: ReadySession): void {
  if (s.role !== 'owner' && s.role !== 'admin') {
    throw new ForbiddenError(`The ${s.role} role cannot administer members or settings.`);
  }
}

export type { Role };

/** Remembers which organisation this browser is working in. */
export async function setTenantCookie(tenantId: string) {
  const jar = await cookies();
  jar.set(TENANT_COOKIE, tenantId, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: 365 * 24 * 3600,
  });
}

/**
 * Rejects cross-site state-changing requests.
 *
 * The suite's sign-in cookie is SameSite=Lax, which already keeps it off a cross-site POST,
 * so this is the second layer rather than the only one. A request with no Origin at all
 * (a server-to-server call) is allowed through; it still needs a gateway identity.
 */
export async function assertSameOrigin() {
  const { origin, host } = await requestContext();
  if (!origin) return;
  let originHost: string;
  try {
    originHost = new URL(origin).host;
  } catch {
    throw new ForbiddenError('Malformed Origin header.');
  }
  if (!host || originHost !== host) {
    throw new ForbiddenError('Cross-origin request refused.');
  }
}
