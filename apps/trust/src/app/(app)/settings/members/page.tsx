import { pageSession, Forbidden } from '@/components/guard';
import { listMembers, pendingInvitations, canAdminister } from '@/lib/auth';
import { MemberList, AddMemberForm, PendingList } from '@/components/member-admin';
import { Card, CardHead, Empty, PageHead } from '@/components/ui';

export const dynamic = 'force-dynamic';

export default async function MembersPage() {
  const s = await pageSession();
  if (!canAdminister(s.role)) {
    return (
      <Forbidden
        message={`The ${s.role} role cannot manage members. Ask an owner or admin for access.`}
      />
    );
  }

  const [members, pending] = await Promise.all([
    listMembers(s.tenantId),
    pendingInvitations(s.tenantId),
  ]);

  return (
    <>
      <PageHead
        eyebrow="Settings"
        title="Members"
        sub={`${members.length} member${members.length === 1 ? '' : 's'} of ${s.tenantName}. People sign in with their suite account; this page decides what they can do here.`}
      />

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHead title="Members" sub="Changes take effect on the member's next request." />
          <MemberList
            meUserId={s.userId}
            canManageOwners={s.role === 'owner'}
            members={members.map((m) => ({
              user_id: m.user_id,
              email: m.email,
              name: m.name,
              role: m.role,
              status: m.status,
              last_login_at: m.last_login_at ? m.last_login_at.toISOString() : null,
            }))}
          />
        </Card>

        <div className="space-y-4">
          <Card>
            <CardHead title="Add a member" />
            <div className="px-4 py-3">
              <AddMemberForm canAddOwner={s.role === 'owner'} />
            </div>
          </Card>

          <Card>
            <CardHead title="Not signed in yet" sub={`${pending.length} pending`} />
            {pending.length === 0 ? (
              <Empty>Everyone added has signed in.</Empty>
            ) : (
              <PendingList
                pending={pending.map((p) => ({
                  id: p.id,
                  email: p.email,
                  role: p.role,
                  created_at: p.created_at.toISOString(),
                }))}
              />
            )}
          </Card>
        </div>
      </div>
    </>
  );
}
