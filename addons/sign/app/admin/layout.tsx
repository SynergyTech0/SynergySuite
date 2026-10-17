
import { getServerSession } from "@/lib/auth";
import { redirect } from 'next/navigation';
import { authOptions } from '@/lib/auth';
import AdminSidebar from '@/components/admin/admin-sidebar';
import { SuiteBar } from '@/components/suite/SuiteBar';

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await getServerSession(authOptions);

  if (!session) redirect('/signin?rd=/admin');
  if (session.user.role !== 'ADMIN') {
    redirect('/dashboard');
  }

  return (
    <div className="flex flex-col h-screen">
    <SuiteBar app="sign" user={session.user.email} domain={process.env.SUITE_DOMAIN} />
    <div className="flex flex-1 min-h-0 bg-gray-50">
      <AdminSidebar />
      <main className="flex-1 overflow-auto">
        {children}
      </main>
    </div>
    </div>
  );
}
