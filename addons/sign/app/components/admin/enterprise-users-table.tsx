
'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { toast } from 'react-hot-toast';
import { UserX, Shield } from 'lucide-react';

interface User {
  id: string;
  name: string | null;
  email: string;
  role: string;
  pricingOverride: boolean;
  createdAt: Date;
  subscription?: {
    tier: string;
  } | null;
}

export default function EnterpriseUsersTable({
  users,
  enterpriseId,
}: {
  users: User[];
  enterpriseId: string;
}) {
  const router = useRouter();
  const [loading, setLoading] = useState<string | null>(null);

  const handleRemoveUser = async (userId: string) => {
    if (!confirm('Are you sure you want to remove this user from the enterprise?')) {
      return;
    }

    setLoading(userId);

    try {
      const response = await fetch(`/api/admin/enterprises/${enterpriseId}/users/${userId}`, {
        method: 'DELETE',
      });

      if (response.ok) {
        toast.success('User removed from enterprise');
        router.refresh();
      } else {
        const error = await response.json();
        toast.error(error.message || 'Failed to remove user');
      }
    } catch (error) {
      toast.error('An error occurred');
    } finally {
      setLoading(null);
    }
  };

  const togglePricingOverride = async (userId: string, currentValue: boolean) => {
    setLoading(userId);

    try {
      const response = await fetch(`/api/admin/users/${userId}/pricing-override`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pricingOverride: !currentValue }),
      });

      if (response.ok) {
        toast.success('Pricing override updated');
        router.refresh();
      } else {
        const error = await response.json();
        toast.error(error.message || 'Failed to update pricing override');
      }
    } catch (error) {
      toast.error('An error occurred');
    } finally {
      setLoading(null);
    }
  };

  if (users.length === 0) {
    return (
      <div className="text-center py-8 text-muted-foreground">
        No users in this enterprise yet
      </div>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full">
        <thead>
          <tr className="border-b">
            <th className="text-left py-3 px-4">Name</th>
            <th className="text-left py-3 px-4">Email</th>
            <th className="text-left py-3 px-4">Role</th>
            <th className="text-left py-3 px-4">Pricing</th>
            <th className="text-left py-3 px-4">Joined</th>
            <th className="text-right py-3 px-4">Actions</th>
          </tr>
        </thead>
        <tbody>
          {users.map((user) => (
            <tr key={user.id} className="border-b hover:bg-muted/50">
              <td className="py-3 px-4">{user.name || 'N/A'}</td>
              <td className="py-3 px-4">{user.email}</td>
              <td className="py-3 px-4">
                <span className="px-2 py-1 text-xs font-medium bg-blue-100 text-blue-800 rounded-full capitalize">
                  {user.role.toLowerCase().replace('_', ' ')}
                </span>
              </td>
              <td className="py-3 px-4">
                <Button
                  variant={user.pricingOverride ? 'default' : 'outline'}
                  size="sm"
                  onClick={() => togglePricingOverride(user.id, user.pricingOverride)}
                  disabled={loading === user.id}
                >
                  <Shield className="h-3 w-3 mr-1" />
                  {user.pricingOverride ? 'Free' : 'Charged'}
                </Button>
              </td>
              <td className="py-3 px-4 text-sm text-muted-foreground">
                {new Date(user.createdAt).toLocaleDateString()}
              </td>
              <td className="py-3 px-4 text-right">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => handleRemoveUser(user.id)}
                  disabled={loading === user.id}
                >
                  <UserX className="h-4 w-4" />
                </Button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
