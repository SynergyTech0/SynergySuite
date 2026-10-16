'use client';

import { useState, useEffect } from 'react';
import { signOut } from "@/lib/session-client";
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { LogOut, Crown, Building2, FileSignature } from 'lucide-react';
import { NotificationBell } from './notifications/notification-bell';
import Link from 'next/link';

interface DashboardHeaderProps {
  updateSearchQuery: (query: string) => void;
  user?: any;
  onMenuClick?: () => void;
}

export function DashboardHeader({ updateSearchQuery, user, onMenuClick }: DashboardHeaderProps) {
  const [searchQuery, setSearchQuery] = useState('');

  useEffect(() => {
    const timer = setTimeout(() => {
      updateSearchQuery(searchQuery);
    }, 300);

    return () => clearTimeout(timer);
  }, [searchQuery, updateSearchQuery]);

  const getSubscriptionBadge = (subscription: any) => {
    if (!subscription) return null;

    const tierColors = {
      FREE: 'bg-gray-200 text-gray-800',
      BASIC: 'bg-blue-100 text-blue-800',
      PRO: 'bg-purple-100 text-purple-800',
      ENTERPRISE: 'bg-gradient-to-r from-yellow-400 to-orange-500 text-white',
    };

    return (
      <Badge
        className={`text-xs px-2 py-0.5 rounded ${
          tierColors[subscription.tier as keyof typeof tierColors] || 'bg-gray-200 text-gray-800'
        }`}
      >
        {subscription.tier === 'ENTERPRISE' && (
          <Crown className="w-3 h-3 mr-1 inline-block" />
        )}
        {subscription.tier}
      </Badge>
    );
  };


  if (!user) {
    return (
      <header className="bg-white border-b border-gray-200 px-6 py-4">
        <h2>Loading...</h2>
      </header>
    );
  }

  const showEnterprise = Boolean(user?.enterpriseId && user?.isEnterpriseAdmin);

  return (
    <header className="bg-white border-b border-gray-200 px-6 py-4">
      <div className="flex items-center justify-between w-full">
        {/* LEFT SIDE */}
        <div className="flex items-center space-x-4">
          <Link href="/dashboard">
            <div className="flex items-center space-x-2 cursor-pointer">
              <div className="bg-blue-600 p-2 rounded-lg">
                <FileSignature className="w-5 h-5 text-white" />
              </div>
              <span className="text-lg font-bold text-gray-900">SynergySign</span>
            </div>
          </Link>
        </div>

        {/* RIGHT SIDE */}
        <div className="flex items-center space-x-4">
          <NotificationBell />

          <div className="flex items-center space-x-2">
            {/* LEFT SIDE — NAME + EMAIL + BADGE */}
            <div className="flex flex-col items-start hidden sm:flex">
              <span className="text-sm font-semibold text-gray-900">
                {user?.name}
              </span>

              <div className="flex items-center space-x-2">

                {/* email */}
                <span className="text-xs text-gray-600">{user?.email}</span>

                {/* BADGE OUTSIDE DROPDOWN TRIGGER */}
                <Link href="/dashboard/billing" onClick={(e) => e.stopPropagation()}>
                  {getSubscriptionBadge(user?.subscription)}
                </Link>
              </div>
            </div>

            {/* DROPDOWN TRIGGER */}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  className="flex items-center space-x-3 hover:bg-gray-50 px-3 !py-1 h-auto rounded-lg"
                >
                  <Avatar className="w-9 h-9 ring-1 ring-gray-200">
                    <AvatarFallback className="text-sm font-medium">
                      {user?.name?.charAt(0) || "U"}
                    </AvatarFallback>
                  </Avatar>
                </Button>
              </DropdownMenuTrigger>

              <DropdownMenuContent align="end" className="w-56">
                <DropdownMenuLabel>My Account</DropdownMenuLabel>
                <DropdownMenuSeparator />

                {showEnterprise && (
                  <>
                    <DropdownMenuItem onClick={() => window.location.href = '/dashboard/enterprise'}>
                      <Building2 className="mr-2 h-4 w-4" />
                      <span>Manage Enterprise</span>
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                  </>
                )}

                <DropdownMenuItem 
                  onClick={async () => {
                    signOut({ callbackUrl: '/' });
                  }}
                  className="text-red-600 focus:text-red-600"
                >
                  <LogOut className="mr-2 h-4 w-4" />
                  <span>Sign out</span>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
      </div>
    </header>
  );
}
