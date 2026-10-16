
'use client';

import { useSession } from "@/lib/session-client";
import { DashboardHeader } from '@/components/dashboard/dashboard-header';
import { DashboardStats } from '@/components/dashboard/dashboard-stats';
import { RecentDocuments } from '@/components/dashboard/recent-documents';
import { QuickActions } from '@/components/dashboard/quick-actions';
import { Loader2 } from 'lucide-react';
import { useState } from 'react';

export function DashboardContent() {
  const { data: session, status } = useSession();
  const [ searchQuery, setSearchQuery ] = useState('');
  

  if (status === 'loading') {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-blue-600" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">      
      <div className={'transition-all duration-300'}>
        <DashboardHeader 
          updateSearchQuery={(query) => setSearchQuery(query)}
          user={session?.user}
        />
        
        <main className="p-6 space-y-6">
          <div className="space-y-1">
            <h1 className="text-3xl font-bold text-gray-900">
              Welcome back, {session?.user?.name?.split(' ')[0] || 'User'}!
            </h1>
            <p className="text-gray-600">
              Manage your documents and signature workflows from your centralized dashboard.
            </p>
          </div>

          <DashboardStats />
          
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <div className="lg:col-span-2">
              <RecentDocuments query={searchQuery} />
            </div>
            <div>
              <QuickActions />
            </div>
          </div>
        </main>
      </div>
    </div>
  );
}

