import { getServerSession } from "@/lib/auth";
import { authOptions } from '@/lib/auth';
import { redirect } from 'next/navigation';
import { DashboardContent } from '@/components/dashboard/dashboard-content';

export default async function DashboardPage() {
  const session = await getServerSession(authOptions);

  if (!session) {
    redirect('/signin?rd=/dashboard');
  }

  return <DashboardContent />;
}

