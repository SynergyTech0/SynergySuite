// Access: who a suite user is in Trust, which organisations they belong to, and membership
// administration.
//
// Sign-in belongs to the suite. The gateway proves who the person is and passes their email
// on every request (see @synergy/identity); this module turns that email into a Trust user
// row and a set of memberships. Nothing here reads cookies or Request objects, so it can be
// driven from a script as easily as from a route handler; the Next.js plumbing lives in
// session.ts.
//
// Every function here runs on the OWNER connection. Resolving a person's memberships across
// organisations necessarily happens before any tenant is known; 006 exempts the identity
// tables (users, tenants, tenant_members) from FORCE RLS for exactly this reason.

import type { Sql, TransactionSql } from 'postgres';
import { sharedSql } from './queries';

export const ROLES = ['owner', 'admin', 'contributor', 'auditor', 'viewer'] as const;
export type Role = (typeof ROLES)[number];

/** Read-only roles get a read-only Postgres role, not just a disabled button. */
export function isReadOnly(role: Role): boolean {
  return role === 'auditor' || role === 'viewer';
}

/** Only these roles may add members, change member roles, or alter tenant configuration. */
export function canAdminister(role: Role): boolean {
  return role === 'owner' || role === 'admin';
}

/** A visit is a run of requests with no gap longer than this; each visit is logged once. */
export const VISIT_IDLE_MINUTES = 30;

export type AccessContext = { ip?: string | null; userAgent?: string | null };

/** The person the suite gateway says is making the request. */
export type SuiteIdentity = { email: string; name: string };

export class AuthError extends Error {
  constructor(message: string, readonly code: string) {
    super(message);
  }
}

// ───────────────────────────────────────────────────────────────────────────
// Event log
// ───────────────────────────────────────────────────────────────────────────

type AuthDetail = Record<string, string | number | boolean | null | undefined>;
type Db = Sql | TransactionSql;

/** Appends to `auth_events`, the global append-only access log. */
export async function logAuth(
  event: string,
  fields: {
    email?: string | null;
    userId?: string | null;
    tenantId?: string | null;
    detail?: AuthDetail;
  } & AccessContext,
  db: Db = sharedSql(),
) {
  await db`
    INSERT INTO auth_events (event, email, user_id, tenant_id, ip, user_agent, detail)
    VALUES (${event}, ${fields.email ?? null}, ${fields.userId ?? null},
            ${fields.tenantId ?? null}, ${fields.ip ?? null}, ${fields.userAgent ?? null},
            ${db.json((fields.detail ?? {}) as Record<string, never>)})`;
}

// ───────────────────────────────────────────────────────────────────────────
// Memberships
// ───────────────────────────────────────────────────────────────────────────

export type Membership = { tenantId: string; slug: string; name: string; role: Role };

export async function membershipsFor(userId: string, db: Db = sharedSql()): Promise<Membership[]> {
  return db<Membership[]>`
    SELECT t.id AS "tenantId", t.slug, t.name, m.role
    FROM tenant_members m
    JOIN tenants t ON t.id = m.tenant_id
    WHERE m.user_id = ${userId} AND t.status = 'active'
    ORDER BY t.name, t.id`;
}

// ───────────────────────────────────────────────────────────────────────────
// Resolving a suite user
// ───────────────────────────────────────────────────────────────────────────

export type TrustUser = {
  id: string;
  email: string;
  name: string;
  status: 'invited' | 'active' | 'suspended';
};

export type ResolvedUser = { user: TrustUser; memberships: Membership[] };

/** The organisation name for the first user's default organisation. */
export function defaultCompanyName(env: NodeJS.ProcessEnv = process.env): string {
  return env.TRUST_COMPANY_NAME?.trim() || 'My Company';
}

/** A tenant slug derived from a name: lower-case and hyphenated, 3 to 34 characters. */
export function slugFor(name: string): string {
  const base = name
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 34)
    .replace(/-+$/g, '');
  return base.length >= 3 ? base : `org-${base || 'trust'}`.slice(0, 34);
}

async function uniqueSlug(db: Db, name: string): Promise<string> {
  const base = slugFor(name);
  for (let n = 1; n < 1000; n++) {
    const slug = n === 1 ? base : `${base}-${n}`;
    const [taken] = await db`SELECT 1 FROM tenants WHERE slug = ${slug}`;
    if (!taken) return slug;
  }
  throw new Error(`no free tenant slug for '${name}'`);
}

/**
 * Converts every pending invitation for this email into a membership. Runs on each request,
 * so an invitation takes effect on the person's next page load, whether or not they have
 * used Trust before.
 */
async function claimInvitations(db: Db, user: TrustUser, ctx: AccessContext) {
  const claimed = await db<{ id: string; tenant_id: string; role: Role }[]>`
    WITH pending AS (
      SELECT id, tenant_id, role FROM invitations
      WHERE email = ${user.email.toLowerCase()} AND accepted_at IS NULL AND revoked_at IS NULL
        AND (expires_at IS NULL OR expires_at > now())
      FOR UPDATE SKIP LOCKED
    ), joined AS (
      INSERT INTO tenant_members (tenant_id, user_id, role)
      SELECT tenant_id, ${user.id}, role FROM pending
      ON CONFLICT (tenant_id, user_id) DO NOTHING
    )
    UPDATE invitations i SET accepted_at = now(), accepted_user_id = ${user.id}
    FROM pending p WHERE i.id = p.id
    RETURNING i.id, i.tenant_id, i.role`;
  for (const inv of claimed) {
    await logAuth(
      'invitation.claimed',
      { userId: user.id, email: user.email, tenantId: inv.tenant_id, detail: { role: inv.role }, ...ctx },
      db,
    );
  }
  return claimed.length;
}

/**
 * Finds or creates the Trust user for a suite identity and returns their memberships.
 *
 * The first suite user to arrive when nobody belongs to any organisation is given a default
 * organisation (TRUST_COMPANY_NAME, else "My Company") as its owner. Everyone after that
 * gets in only through an invitation an owner or admin issued for their email; without one
 * they have a user row and no memberships, which grants nothing.
 */
export async function resolveSuiteUser(
  identity: SuiteIdentity,
  ctx: AccessContext = {},
): Promise<ResolvedUser> {
  const sql = sharedSql();
  const email = identity.email.trim().toLowerCase();
  const name = identity.name.trim() || email;

  const [known] = await sql<TrustUser[]>`
    SELECT id, email, name, status FROM users WHERE lower(email) = ${email}`;

  if (!known) {
    // Serialised so two people arriving at once cannot both become the first owner.
    const user = await sql.begin(async (tx) => {
      await tx`SELECT pg_advisory_xact_lock(hashtext('trust.first-user'))`;
      const [existing] = await tx<TrustUser[]>`
        SELECT id, email, name, status FROM users WHERE lower(email) = ${email}`;
      if (existing) return existing;

      const [created] = await tx<TrustUser[]>`
        INSERT INTO users (email, name, status, last_login_at)
        VALUES (${email}, ${name}, 'active', now())
        RETURNING id, email, name, status`;
      await logAuth('access.first_seen', { userId: created.id, email, ...ctx }, tx);

      await claimInvitations(tx, created, ctx);
      const [{ members }] = await tx<{ members: number }[]>`
        SELECT count(*)::int AS members FROM tenant_members`;
      if (members === 0) {
        const companyName = defaultCompanyName();
        const slug = await uniqueSlug(tx, companyName);
        const [{ id: tenantId }] = await tx<{ id: string }[]>`
          SELECT trust_provision_tenant(${slug}, ${companyName}) AS id`;
        await tx`
          INSERT INTO tenant_members (tenant_id, user_id, role)
          VALUES (${tenantId}, ${created.id}, 'owner')`;
        await logAuth(
          'tenant.created',
          {
            userId: created.id, email, tenantId,
            detail: { slug, name: companyName, first_user: true }, ...ctx,
          },
          tx,
        );
      }
      return created;
    });
    const memberships = user.status === 'suspended' ? [] : await membershipsFor(user.id);
    if (!memberships.length) await logAuth('access.denied', { userId: user.id, email, ...ctx });
    return { user, memberships };
  }

  if (known.status === 'suspended') {
    await recordVisit(known, name, ctx, 'access.suspended');
    return { user: known, memberships: [] };
  }

  await claimInvitations(sql, known, ctx);
  const memberships = await membershipsFor(known.id);
  await recordVisit(known, name, ctx, memberships.length ? 'access.signed_in' : 'access.denied');
  return { user: known, memberships };
}

/**
 * Logs the start of a visit, at most once per VISIT_IDLE_MINUTES of inactivity, and keeps
 * the display name in step with the suite. Logging every request would bury the events
 * that matter; logging none would leave no record of who used the product and when.
 */
async function recordVisit(user: TrustUser, name: string, ctx: AccessContext, event: string) {
  const sql = sharedSql();
  const [fresh] = await sql<{ id: string }[]>`
    UPDATE users SET last_login_at = now(), name = ${name}
    WHERE id = ${user.id}
      AND (last_login_at IS NULL
           OR last_login_at < now() - ${`${VISIT_IDLE_MINUTES} minutes`}::interval)
    RETURNING id`;
  if (fresh) {
    await logAuth(event, { userId: user.id, email: user.email, ...ctx });
  } else {
    // Still within a visit: only the timestamp moves, nothing is logged.
    await sql`UPDATE users SET last_login_at = now() WHERE id = ${user.id}`;
  }
}

// ───────────────────────────────────────────────────────────────────────────
// Membership administration
// ───────────────────────────────────────────────────────────────────────────

export async function listMembers(tenantId: string) {
  const sql = sharedSql();
  return sql<
    {
      user_id: string; email: string; name: string; role: Role; status: string;
      last_login_at: Date | null; joined_at: Date;
    }[]
  >`
    SELECT u.id AS user_id, u.email, u.name, m.role, u.status,
           u.last_login_at, m.created_at AS joined_at
    FROM tenant_members m JOIN users u ON u.id = m.user_id
    WHERE m.tenant_id = ${tenantId}
    ORDER BY m.role, u.email`;
}

export async function pendingInvitations(tenantId: string) {
  const sql = sharedSql();
  return sql<
    { id: string; email: string; role: Role; created_at: Date; invited_by_name: string | null }[]
  >`
    SELECT i.id, i.email, i.role, i.created_at, u.name AS invited_by_name
    FROM invitations i LEFT JOIN users u ON u.id = i.invited_by
    WHERE i.tenant_id = ${tenantId} AND i.accepted_at IS NULL AND i.revoked_at IS NULL
    ORDER BY i.created_at DESC`;
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Adds a member by email. If that person already uses Trust they join immediately;
 * otherwise a pending invitation is stored and becomes a membership the first time they
 * arrive through the suite gateway. Adding the same email again replaces the pending role.
 */
export async function addMember(opts: {
  tenantId: string;
  email: string;
  role: Role;
  actor: { userId: string; role: Role };
}): Promise<{ status: 'joined' | 'pending'; email: string; role: Role }> {
  const email = opts.email.trim().toLowerCase();
  if (!EMAIL.test(email)) throw new AuthError('Enter a valid email address.', 'bad_email');
  if (!ROLES.includes(opts.role)) throw new AuthError(`Unknown role '${opts.role}'.`, 'bad_role');
  // Only an owner may create another owner; an admin minting an owner would be a
  // privilege-escalation path straight through member administration.
  if (opts.role === 'owner' && opts.actor.role !== 'owner') {
    throw new AuthError('Only an owner can add another owner.', 'owner_only');
  }

  const sql = sharedSql();
  return sql.begin(async (tx) => {
    const [existing] = await tx<{ id: string; role: Role | null }[]>`
      SELECT u.id, m.role FROM users u
      LEFT JOIN tenant_members m ON m.user_id = u.id AND m.tenant_id = ${opts.tenantId}
      WHERE lower(u.email) = ${email}`;
    if (existing?.role) {
      throw new AuthError(
        `${email} is already a member (${existing.role}). Change their role instead.`,
        'already_member',
      );
    }

    await tx`
      UPDATE invitations SET revoked_at = now()
      WHERE tenant_id = ${opts.tenantId} AND email = ${email}
        AND accepted_at IS NULL AND revoked_at IS NULL`;
    const [inv] = await tx<{ id: string }[]>`
      INSERT INTO invitations (tenant_id, email, role, invited_by)
      VALUES (${opts.tenantId}, ${email}, ${opts.role}, ${opts.actor.userId})
      RETURNING id`;

    let status: 'joined' | 'pending' = 'pending';
    if (existing) {
      await tx`
        INSERT INTO tenant_members (tenant_id, user_id, role)
        VALUES (${opts.tenantId}, ${existing.id}, ${opts.role})`;
      await tx`
        UPDATE invitations SET accepted_at = now(), accepted_user_id = ${existing.id}
        WHERE id = ${inv.id}`;
      status = 'joined';
    }
    await logAuth(
      'member.added',
      { userId: opts.actor.userId, tenantId: opts.tenantId, email, detail: { role: opts.role, status } },
      tx,
    );
    return { status, email, role: opts.role };
  });
}

export async function revokeInvitation(tenantId: string, invitationId: string, actorUserId: string) {
  const sql = sharedSql();
  const [row] = await sql<{ email: string }[]>`
    UPDATE invitations SET revoked_at = now()
    WHERE id = ${invitationId} AND tenant_id = ${tenantId}
      AND accepted_at IS NULL AND revoked_at IS NULL
    RETURNING email`;
  if (!row) throw new AuthError('No pending invitation with that id.', 'no_invitation');
  await logAuth('invitation.revoked', { userId: actorUserId, tenantId, email: row.email });
}

export async function setMemberRole(
  tenantId: string,
  targetUserId: string,
  role: Role,
  actor: { userId: string; role: Role },
) {
  if (!ROLES.includes(role)) throw new AuthError(`Unknown role '${role}'.`, 'bad_role');
  if (role === 'owner' && actor.role !== 'owner') {
    throw new AuthError('Only an owner can make someone an owner.', 'owner_only');
  }
  const sql = sharedSql();

  const [current] = await sql<{ role: Role }[]>`
    SELECT role FROM tenant_members WHERE tenant_id = ${tenantId} AND user_id = ${targetUserId}`;
  if (!current) throw new AuthError('That user is not a member of this organisation.', 'no_membership');
  if (current.role === 'owner' && role !== 'owner') {
    if (actor.role !== 'owner') {
      throw new AuthError("Only an owner can change an owner's role.", 'owner_only');
    }
    // A tenant with no owner cannot be administered by anyone, and nothing else in the
    // schema prevents the last one demoting themselves.
    const [{ owners }] = await sql<{ owners: number }[]>`
      SELECT count(*)::int AS owners FROM tenant_members
      WHERE tenant_id = ${tenantId} AND role = 'owner' AND user_id <> ${targetUserId}`;
    if (owners === 0) {
      throw new AuthError('An organisation must keep at least one owner.', 'last_owner');
    }
  }

  const [row] = await sql<{ role: Role }[]>`
    UPDATE tenant_members SET role = ${role}
    WHERE tenant_id = ${tenantId} AND user_id = ${targetUserId}
    RETURNING role`;

  await logAuth('member.role_changed', {
    userId: actor.userId, tenantId, detail: { target: targetUserId, role },
  });
  return row.role;
}

/**
 * Removes a membership. Access ends on that person's next request, because every request
 * re-reads memberships; there is no Trust session left alive to revoke.
 */
export async function removeMember(
  tenantId: string,
  targetUserId: string,
  actor: { userId: string; role: Role },
) {
  const sql = sharedSql();
  const [current] = await sql<{ role: Role }[]>`
    SELECT role FROM tenant_members WHERE tenant_id = ${tenantId} AND user_id = ${targetUserId}`;
  if (!current) throw new AuthError('That user is not a member of this organisation.', 'no_membership');
  if (current.role === 'owner') {
    if (actor.role !== 'owner') {
      throw new AuthError('Only an owner can remove an owner.', 'owner_only');
    }
    const [{ owners }] = await sql<{ owners: number }[]>`
      SELECT count(*)::int AS owners FROM tenant_members
      WHERE tenant_id = ${tenantId} AND role = 'owner' AND user_id <> ${targetUserId}`;
    if (owners === 0) {
      throw new AuthError('An organisation must keep at least one owner.', 'last_owner');
    }
  }

  await sql`DELETE FROM tenant_members WHERE tenant_id = ${tenantId} AND user_id = ${targetUserId}`;
  await logAuth('member.removed', { userId: actor.userId, tenantId, detail: { target: targetUserId } });
}
