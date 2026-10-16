
'use client';

import { useSession } from 'next-auth/react';
import Link from 'next/link';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Upload, FileText, PenTool, Users, Zap, Clipboard } from 'lucide-react';

export function QuickActions() {
  const { data: session } = useSession();

  const actions = [
    {
      title: 'Upload Document',
      description: 'Upload a new document for signing',
      icon: Upload,
      href: '/dashboard/documents/upload',
      color: 'bg-blue-600 hover:bg-blue-700',
      roles: ['ADMIN', 'SENDER']
    },
    {
      title: 'Create Template',
      description: 'Build reusable document templates',
      icon: Clipboard,
      href: '/dashboard/templates/create',
      color: 'bg-green-600 hover:bg-green-700',
      roles: ['ADMIN', 'SENDER']
    },
    {
      title: 'Sign Documents',
      description: 'View and sign pending documents',
      icon: PenTool,
      href: '/dashboard/sign',
      color: 'bg-purple-600 hover:bg-purple-700',
      roles: ['ADMIN', 'SENDER', 'SIGNER']
    },
    {
      title: 'Manage Signers',
      description: 'Add and organize your signers',
      icon: Users,
      href: '/dashboard/signers',
      color: 'bg-orange-600 hover:bg-orange-700',
      roles: ['ADMIN', 'SENDER']
    },
    {
      title: 'View All Documents',
      description: 'Browse your document library',
      icon: FileText,
      href: '/dashboard/documents',
      color: 'bg-gray-600 hover:bg-gray-700',
      roles: ['ADMIN', 'SENDER', 'SIGNER']
    }
  ];

  const filteredActions = actions.filter(action => 
    action.roles.includes(session?.user?.role || 'SIGNER')
  );

  return (
    <Card className="border-0 shadow-md">
      <CardHeader>
        <CardTitle className="flex items-center space-x-2">
          <Zap className="w-5 h-5 text-blue-600" />
          <span>Quick Actions</span>
        </CardTitle>
        <CardDescription>
          Get started with common tasks
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="grid gap-3">
          {filteredActions.map((action) => (
            <Link key={action.title} href={action.href}>
              <Button 
                variant="outline" 
                className="w-full justify-start h-auto p-4 hover:shadow-md transition-all"
              >
                <div className="flex items-center space-x-4 text-left">
                  <div className={`p-2 rounded-lg text-white ${action.color}`}>
                    <action.icon className="w-4 h-4" />
                  </div>
                  <div>
                    <p className="font-medium text-gray-900">{action.title}</p>
                    <p className="text-sm text-gray-500">{action.description}</p>
                  </div>
                </div>
              </Button>
            </Link>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

