
import { notFound } from 'next/navigation';
import { prisma } from '@/lib/db';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { ArrowLeft, Users, Mail, Calendar } from 'lucide-react';
import Link from 'next/link';
import EnterpriseUsersTable from '@/app/components/admin/enterprise-users-table';
import EnterpriseEditForm from '@/app/components/admin/enterprise-edit-form';

export default async function EnterpriseDetailPage({
  params,
}: {
  params: { id: string };
}) {
  const enterprise = await prisma.enterpriseAccount.findUnique({
    where: { id: params.id },
    include: {
      users: {
        include: {
          subscription: true,
        },
        orderBy: {
          createdAt: 'desc',
        },
      },
    },
  });

  if (!enterprise) {
    notFound();
  }

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center space-x-4">
        <Link href="/admin/enterprises">
          <Button variant="ghost" size="sm">
            <ArrowLeft className="h-4 w-4 mr-2" />
            Back
          </Button>
        </Link>
        <div>
          <h1 className="text-3xl font-bold">{enterprise.name}</h1>
        </div>
      </div>

      {/* Enterprise Info */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Status</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {enterprise.isActive ? (
                <span className="text-green-600">Active</span>
              ) : (
                <span className="text-gray-600">Inactive</span>
              )}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">User Allocation</CardTitle>
            <Users className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {enterprise.currentUserCount} / {enterprise.userLimit}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Contact</CardTitle>
            <Mail className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-sm font-bold">{enterprise.contactName}</div>
            <div className="text-xs text-muted-foreground">
              {enterprise.contactEmail}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Contract End</CardTitle>
            <Calendar className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-sm font-bold">
              {enterprise.contractEndDate
                ? new Date(enterprise.contractEndDate).toLocaleDateString()
                : 'N/A'}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Edit Form */}
      <EnterpriseEditForm enterprise={enterprise} />

      {/* Users Table */}
      <Card>
        <CardHeader>
          <CardTitle>Enterprise Users</CardTitle>
        </CardHeader>
        <CardContent>
          <EnterpriseUsersTable users={enterprise.users} enterpriseId={enterprise.id} />
        </CardContent>
      </Card>
    </div>
  );
}
