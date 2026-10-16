import { NextResponse } from 'next/server';
import { currentAccess } from '@/lib/session';

export const dynamic = 'force-dynamic';

/**
 * GET /api/me — who the suite says the caller is, and what they may do in Trust.
 *
 * 401 when no suite identity reached the app; 403 with `auth: "no_access"` when the person
 * is signed in to the suite but belongs to no organisation here.
 */
export async function GET() {
  const access = await currentAccess();
  const noStore = { 'cache-control': 'no-store' };
  if (access.state === 'anonymous') {
    return NextResponse.json({ error: 'Not signed in.', auth: 'required' }, { status: 401, headers: noStore });
  }
  if (access.state === 'no_access') {
    return NextResponse.json(
      {
        error: 'Not a member of any organisation. Ask an administrator to add you.',
        auth: 'no_access',
        user: { email: access.email },
        suspended: access.suspended,
      },
      { status: 403, headers: noStore },
    );
  }
  const s = access.session;
  return NextResponse.json(
    {
      user: { id: s.userId, email: s.userEmail, name: s.userName },
      tenant: { id: s.tenantId, slug: s.tenantSlug, name: s.tenantName, role: s.role, readOnly: s.readOnly },
      memberships: s.memberships,
    },
    { headers: noStore },
  );
}
