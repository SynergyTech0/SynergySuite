import { route, jsonBody, requireString } from '@/lib/api';
import { logAuth } from '@/lib/auth';
import { ForbiddenError, requestContext, setTenantCookie } from '@/lib/session';

export const dynamic = 'force-dynamic';

/**
 * POST /api/tenant   { tenantId }
 *
 * Switches the organisation this browser works in. Membership is checked against the
 * database here and again on every later request; the cookie only records the choice.
 * Not a write route: a read-only seat may still switch between its own organisations.
 */
export const POST = route(async (session, req) => {
  const tenantId = requireString(await jsonBody(req), 'tenantId');
  const m = session.memberships.find((x) => x.tenantId === tenantId);
  if (!m) throw new ForbiddenError('You are not a member of that organisation.');
  await setTenantCookie(m.tenantId);
  const ctx = await requestContext();
  await logAuth('session.tenant_switched', {
    userId: session.userId, email: session.userEmail, tenantId: m.tenantId,
    detail: { role: m.role }, ip: ctx.ip, userAgent: ctx.userAgent,
  });
  return { ok: true, tenant: { id: m.tenantId, name: m.name, role: m.role } };
});
