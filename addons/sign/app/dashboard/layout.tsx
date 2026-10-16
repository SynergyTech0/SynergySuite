import { Sidebar } from '@/components/dashboard/sidebar';
import { SidebarProvider } from '@/contexts/sidebar-context';
import { getServerSession } from "@/lib/auth";
import { authOptions } from '@/lib/auth';
import { redirect } from 'next/navigation';
import { SuiteBar } from '@/components/suite/SuiteBar';

function DashboardLayoutContent({ children }: { children: React.ReactNode }) {   
  return (
    <div className="min-h-[calc(100vh-3rem)] bg-gray-50">
      {/*Pass both collapse & open props to Sidebar */}
      <Sidebar />

      <div className="flex">
        {/* Space for sidebar */}
        <div className="w-20 flex-shrink-0"></div>

        {/*Adjust main content width dynamically when collapsed */}
        <main className='w-full bg-gray-50'>
          {children}
        </main>
      </div>
    </div>
  );
}

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const session = await getServerSession(authOptions);
  
  if (!session) {
    redirect('/signin?rd=/dashboard');
  }

  return (
    <SidebarProvider>
      <SuiteBar app="sign" user={session.user.email} domain={process.env.SUITE_DOMAIN} />
      <DashboardLayoutContent>{children}</DashboardLayoutContent>
    </SidebarProvider>
  );
}
