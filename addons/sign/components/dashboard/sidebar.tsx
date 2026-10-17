'use client';

import { useEffect, useState } from 'react';
import { useSession } from "@/lib/session-client";
import { usePathname } from 'next/navigation';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import {
  FileSignature,
  Home,
  FileText,
  Users,
  Clipboard,
  Settings,
  BarChart3,
  CreditCard,
  X,
  Upload,
  PenTool,
  ShieldCheck,
  DollarSign,
  ChevronLeft
} from 'lucide-react';
import { useSidebar } from '@/contexts/sidebar-context';

export function Sidebar() {
  const { data: session } = useSession();
  const pathname = usePathname();

  const { isOpen, setIsOpen } = useSidebar();
  const [hoverOpen, setHoverOpen] = useState(false);

  // Auto-expand only on desktop
  const sidebarOpen = hoverOpen || isOpen;

  // FIX: Active route detection works for nested routes
  const isActiveRoute = (href: string) => {
    // Currently does not take into account child routes, if needed to add, must filter for any repeat routes such as /dashboard and /dashboard/documents to avoid false positives
    return pathname === href || pathname === href + '/';
  };

  const navigation = [
    { name: 'Dashboard', href: '/dashboard', icon: Home, roles: ['ADMIN', 'SENDER', 'SIGNER'] },
    { name: 'Documents', href: '/dashboard/documents', icon: FileText, roles: ['ADMIN', 'SENDER', 'SIGNER'] },
    { name: 'Templates', href: '/dashboard/templates', icon: Clipboard, roles: ['ADMIN', 'SENDER'] },
    { name: 'Signers', href: '/dashboard/signers', icon: Users, roles: ['ADMIN', 'SENDER'] },
    { name: 'Analytics', href: '/dashboard/analytics', icon: BarChart3, roles: ['ADMIN', 'SENDER'] },
    { name: 'Billing', href: '/dashboard/billing', icon: CreditCard, roles: ['ADMIN', 'SENDER'], exclude: ['ENTERPRISE'] },
    { name: 'Affiliates', href: '/dashboard/affiliates', icon: DollarSign, roles: ['ADMIN', 'SENDER', 'SIGNER'], exclude: ['ENTERPRISE', 'ENTERPRISE ADMIN'] },
    { name: 'Admin Panel', href: '/admin', icon: ShieldCheck, roles: ['ADMIN'] },
    { name: 'Settings', href: '/dashboard/settings', icon: Settings, roles: ['ADMIN', 'SENDER', 'SIGNER'] },
  ];

  const quickActions = [
    { name: 'Upload Document', href: '/dashboard/documents/upload', icon: Upload, color: 'bg-blue-600 hover:bg-blue-700', roles: ['ADMIN', 'SENDER'] },
    { name: 'Create Template', href: '/dashboard/templates/create', icon: Clipboard, color: 'bg-green-600 hover:bg-green-700', roles: ['ADMIN', 'SENDER'] },
    { name: 'Sign Document', href: '/dashboard/sign', icon: PenTool, color: 'bg-purple-600 hover:bg-purple-700', roles: ['ADMIN', 'SENDER', 'SIGNER'] },
  ];

  const filteredNavigation = () => {
    let toReturn = navigation.filter(item => item.roles.includes(session?.user?.role || 'SIGNER'));
    // Paid plans and affiliate payouts belong to the hosted product; a suite runs without them (SIGN_BILLING=1 shows them).
    if (!session?.billing) toReturn = toReturn.filter(item => item.name !== 'Billing' && item.name !== 'Affiliates');
    toReturn = toReturn.filter(item => 
      !(item.exclude?.includes("ENTERPRISE") && session?.user?.subscription?.tier == "ENTERPRISE" && !session?.user?.isEnterpriseAdmin)
    );
    toReturn = toReturn.filter(item => 
      !(item.exclude?.includes("ENTERPRISE ADMIN") && session?.user?.subscription?.tier == "ENTERPRISE" && session?.user?.isEnterpriseAdmin)
    );
    return toReturn;
  }
  const filteredQuickActions = () => {
    return quickActions.filter(item => item.roles.includes(session?.user?.role || 'SIGNER'));
  } 

  return (
    <>
      {/* MOBILE OVERLAY */}
      <div
        className={cn(
          "fixed inset-0 bg-black bg-opacity-50 z-40 transition-opacity duration-300",
          isOpen || hoverOpen ? "opacity-100" : "opacity-0 pointer-events-none"
        )}
        onClick={() => setIsOpen(false)}
      />

      {/* SIDEBAR */}
      <div
        onMouseEnter={() => setHoverOpen(true)}
        onMouseLeave={() => setHoverOpen(false)}
        className={cn(
          "fixed top-12 bottom-0 left-0 z-50 bg-white border-r border-gray-200 overflow-y-auto",
          "transition-all duration-300 ease-in-out flex flex-col",
          sidebarOpen ? "w-72" : "w-20"
        )}
      >
        {/* HEADER */}
        <div className="flex items-center justify-between p-6 border-b border-gray-200">
          <Link href="/dashboard">
            <div className="flex items-center space-x-2 cursor-pointer">
              <div className="bg-blue-600 p-2 rounded-lg">
                <FileSignature className="w-5 h-5 text-white" />
              </div>
              {sidebarOpen && (
                <span className="text-lg font-bold text-gray-900">SynergySign</span>
              )}
            </div>
          </Link>

          {/* MOBILE CLOSE BUTTON */}
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setIsOpen(false)}
            className={"lg:hidden " + (sidebarOpen ? "" : "hidden")}
          >
            <X className="w-4 h-4" />
          </Button>
        </div>

        {/* QUICK ACTIONS */}
        {sidebarOpen && (
          <div className="p-4 border-b border-gray-200">
            <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">
              Quick Actions
            </h3>
            <div className="space-y-2">
              {filteredQuickActions().map(action => (
                <Link
                  key={action.name}
                  href={action.href}
                  onClick={() => setIsOpen(false)}
                  className={cn(
                    "flex items-center space-x-3 px-3 py-2 rounded-lg text-white text-sm font-medium",
                    "transition-all duration-200 hover:scale-105",
                    action.color
                  )}
                >
                  <action.icon className="w-4 h-4" />
                  <span>{action.name}</span>
                </Link>
              ))}
            </div>
          </div>
        )}

        {/* NAVIGATION */}
        <nav className="p-4 overflow-y-auto overflow-x-hidden">
          {sidebarOpen && (
            <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">
              Navigation
            </h3>
          )}
          <div className="space-y-1 flex flex-col">
            {filteredNavigation().map(item => {
              const active = isActiveRoute(item.href);
              return (
                <Link
                  key={item.name}
                  href={item.href}
                  onClick={() => setIsOpen(false)}
                  className={cn(
                    "inline-flex items-center space-x-3 px-3 py-2 rounded-lg text-sm font-medium transition-all",
                    active
                      ? "bg-blue-100 text-blue-700 border-r-2 border-blue-700 shadow-sm"
                      : "text-gray-600 hover:bg-gray-100"
                  )}
                >
                  <item.icon className="w-5 h-5" />
                  {sidebarOpen && <span>{item.name}</span>}
                </Link>
              );
            })}
          </div>
        </nav>

        {/* SUBSCRIPTION INFO */}
        {sidebarOpen && (
          <div className="p-4 border-t border-gray-200">
            <div className="bg-gradient-to-r from-blue-50 to-indigo-50 rounded-lg p-3">
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm font-medium text-gray-900">
                  {session?.user?.subscription?.tier || 'FREE'} Plan
                </span>
                <Badge variant="outline" className="text-xs">
                  {session?.user?.subscription?.status || 'TRIAL'}
                </Badge>
              </div>
              <p className="text-xs text-gray-600 mb-3">
                {session?.user?.subscription?.tier === 'FREE'
                  ? 'Upgrade for more features'
                  : 'Manage your subscription'}
              </p>
              <Link href="/dashboard/billing">
                <Button size="sm" variant="outline" className="w-full text-xs">
                  {session?.user?.subscription?.tier === 'FREE'
                    ? 'Upgrade Plan'
                    : 'Manage Billing'}
                </Button>
              </Link>
            </div>
          </div>
        )}

        {/* COLLAPSE ARROW */}
        <div className="justify-center py-3 border-t border-gray-200 mt-auto flex">
          <Button
            variant="ghost"
            size="icon"
            className="h-9 w-9 rounded-md hover:bg-gray-100"
            onClick={() => setIsOpen(!isOpen)}
          >
            <ChevronLeft
              className={cn(
                "w-5 h-5 transition-transform duration-300",
                !sidebarOpen && "rotate-180"
              )}
            />
          </Button>
        </div>
      </div>
    </>
  );
}
