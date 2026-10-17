
'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import Image from 'next/image';
import { cn } from '@/lib/utils';
import {
  LayoutDashboard,
  Building2,
  Users,
  Settings,
  LogOut,
  FileText,
  Shield,
  DollarSign,
} from 'lucide-react';
import { signOut } from "@/lib/session-client";

const navigation = [
  { name: 'Dashboard', href: '/admin', icon: LayoutDashboard },
  { name: 'Enterprise Accounts', href: '/admin/enterprises', icon: Building2 },
  { name: 'User Management', href: '/admin/users', icon: Users },
  { name: 'Affiliates', href: '/admin/affiliates', icon: DollarSign },
  { name: 'Documents', href: '/admin/documents', icon: FileText },
  { name: 'System Settings', href: '/admin/settings', icon: Settings },
];

export default function AdminSidebar() {
  const pathname = usePathname();

  return (
    <div className="flex flex-col w-64 bg-white border-r">
      <div className="flex items-center h-16 px-6 border-b">
        <div className="flex items-center space-x-2">
          <div className="relative w-8 h-8">
            <Image 
              src="/synergy-logo.png" 
              alt="Synergy Technologies Logo" 
              fill
              className="object-contain"
              priority
            />
          </div>
          <div>
            <span className="text-base font-bold text-gray-900 block leading-tight">Admin Panel</span>
            <span className="text-[10px] text-gray-500">Synergy Technologies</span>
          </div>
        </div>
      </div>

      <nav className="flex-1 px-4 py-6 space-y-2">
        {navigation.map((item) => {
          const Icon = item.icon;
          const isActive = pathname === item.href;

          return (
            <Link
              key={item.name}
              href={item.href}
              className={cn(
                'flex items-center px-4 py-3 rounded-lg transition-colors',
                isActive
                  ? 'bg-gradient-to-r from-purple-600 to-blue-600 text-white'
                  : 'text-muted-foreground hover:bg-muted hover:text-foreground'
              )}
            >
              <Icon className="h-5 w-5 mr-3" />
              <span className="font-medium">{item.name}</span>
            </Link>
          );
        })}
      </nav>

      <div className="p-4 border-t">
        <Link
          href="/dashboard"
          className="flex items-center px-4 py-3 text-muted-foreground hover:bg-muted hover:text-foreground rounded-lg transition-colors mb-2"
        >
          <LayoutDashboard className="h-5 w-5 mr-3" />
          <span className="font-medium">User Dashboard</span>
        </Link>
        <button
          onClick={async () => {
            await fetch('/api/auth/signoutlog', { method: 'POST' });
            signOut({ callbackUrl: '/' });
          }}
          className="w-full flex items-center px-4 py-3 text-muted-foreground hover:bg-muted hover:text-foreground rounded-lg transition-colors"
        >
          <LogOut className="h-5 w-5 mr-3" />
          <span className="font-medium">Logout</span>
        </button>
      </div>
    </div>
  );
}
