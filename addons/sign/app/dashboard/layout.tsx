import { useState } from 'react';
import { Sidebar } from '@/components/dashboard/sidebar';
import { SidebarProvider, useSidebar } from '@/contexts/sidebar-context';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { redirect } from 'next/navigation';

function DashboardLayoutContent({ children }: { children: React.ReactNode }) {   
  return (
    <div className="min-h-screen max-h-screen bg-gray-50">
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
    redirect('/auth/login');
  }

  if (session && !session.user?.verified) {
    redirect('/auth/verify?email=' + encodeURIComponent(session.user.email || ''));
  }

  return (
    <SidebarProvider>
      <DashboardLayoutContent>{children}</DashboardLayoutContent>
    </SidebarProvider>
  );
}
