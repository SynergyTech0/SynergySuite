import { Card } from '@/components/ui/card';
import { prisma } from '@/lib/db';
import UserManagementTable from '@/components/admin/user-management-table';

export const dynamic = 'force-dynamic';

export default async function UsersPage() {
  const users = await prisma.user.findMany({
    include: {
      enterprise: true,
      subscription: true,
    },
    orderBy: { createdAt: 'desc' },
  });

  return (
    <div className="p-8">
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-gray-900">User Management</h1>
        <p className="text-gray-600">Manage all users and their access levels</p>
      </div>

      <Card>
        <UserManagementTable initialUsers={users as any} />
      </Card>
    </div>
  );
}
