import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { redirect } from 'next/navigation';
import { DashboardContent } from '@/components/dashboard/dashboard-content';

export default async function DashboardPage() {
  const session = await getServerSession(authOptions);

  if (!session) {
    redirect('/auth/login');
  }

  if (session && !session.user?.verified) {
    redirect('/auth/verify?email=' + encodeURIComponent(session.user.email || ''));
  }

  return <DashboardContent />;
}

