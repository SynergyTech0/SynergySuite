
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { Users, Building2, FileText, DollarSign } from 'lucide-react';

export default async function AdminDashboard() {
  const session = await getServerSession(authOptions);

  // Get statistics
  const [totalUsers, totalEnterprises, totalDocuments, activeSubscriptions] = await Promise.all([
    prisma.user.count(),
    prisma.enterpriseAccount.count(),
    prisma.document.count(),
    prisma.subscription.count({ where: { status: 'ACTIVE' } }),
  ]);

  const stats = [
    {
      title: 'Total Users',
      value: totalUsers,
      icon: Users,
      description: 'Registered users',
    },
    {
      title: 'Enterprises',
      value: totalEnterprises,
      icon: Building2,
      description: 'Active enterprise accounts',
    },
    {
      title: 'Documents',
      value: totalDocuments,
      icon: FileText,
      description: 'Total documents processed',
    },
    {
      title: 'Active Subscriptions',
      value: activeSubscriptions,
      icon: DollarSign,
      description: 'Paid subscriptions',
    },
  ];

  return (
    <div className="p-8">
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-gray-900">Admin Dashboard</h1>
        <p className="text-gray-600">Welcome back, {session?.user?.name}</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        {stats.map((stat) => (
          <Card key={stat.title}>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">{stat.title}</CardTitle>
              <stat.icon className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{stat.value}</div>
              <p className="text-xs text-muted-foreground">{stat.description}</p>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
