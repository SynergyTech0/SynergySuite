
'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { toast } from 'react-hot-toast';
import { Shield, Building2, Search } from 'lucide-react';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

interface User {
  id: string;
  name: string | null;
  email: string;
  role: string;
  pricingOverride: boolean;
  createdAt: Date;
  enterprise?: {
    name: string;
  } | null;
  subscription?: {
    tier: string;
    status: string;
  } | null;
}

export default function UserManagementTable({ users }: { users: User[] }) {
  const router = useRouter();
  const [search, setSearch] = useState('');
  const [roleFilter, setRoleFilter] = useState('all');
  const [loading, setLoading] = useState<string | null>(null);

  const filteredUsers = users.filter((user) => {
    const matchesSearch =
      user.email.toLowerCase().includes(search.toLowerCase()) ||
      user.name?.toLowerCase().includes(search.toLowerCase());
    const matchesRole = roleFilter === 'all' || user.role === roleFilter;
    return matchesSearch && matchesRole;
  });

  const handleRoleChange = async (userId: string, newRole: string) => {
    setLoading(userId);

    try {
      const response = await fetch(`/api/admin/users/${userId}/role`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ role: newRole }),
      });

      if (response.ok) {
        toast.success('User role updated');
        router.refresh();
      } else {
        const error = await response.json();
        toast.error(error.message || 'Failed to update role');
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

  return (
    <div className="space-y-4">
      <div className="flex gap-4">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search by name or email..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>
        <Select value={roleFilter} onValueChange={setRoleFilter}>
          <SelectTrigger className="w-48">
            <SelectValue placeholder="Filter by role" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Roles</SelectItem>
            <SelectItem value="SENDER">Sender</SelectItem>
            <SelectItem value="SIGNER">Signer</SelectItem>
            <SelectItem value="ADMIN">Admin</SelectItem>
            <SelectItem value="CORPORATE">Corporate</SelectItem>
            <SelectItem value="SYSTEM_ADMIN">System Admin</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full">
          <thead>
            <tr className="border-b">
              <th className="text-left py-3 px-4">User</th>
              <th className="text-left py-3 px-4">Role</th>
              <th className="text-left py-3 px-4">Enterprise</th>
              <th className="text-left py-3 px-4">Subscription</th>
              <th className="text-left py-3 px-4">Pricing</th>
              <th className="text-left py-3 px-4">Joined</th>
            </tr>
          </thead>
          <tbody>
            {filteredUsers.map((user) => (
              <tr key={user.id} className="border-b hover:bg-muted/50">
                <td className="py-3 px-4">
                  <div>
                    <div className="font-medium">{user.name || 'N/A'}</div>
                    <div className="text-sm text-muted-foreground">{user.email}</div>
                  </div>
                </td>
                <td className="py-3 px-4">
                  <Select
                    value={user.role}
                    onValueChange={(value) => handleRoleChange(user.id, value)}
                    disabled={loading === user.id}
                  >
                    <SelectTrigger className="w-40">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="SENDER">Sender</SelectItem>
                      <SelectItem value="SIGNER">Signer</SelectItem>
                      <SelectItem value="ADMIN">Admin</SelectItem>
                      <SelectItem value="CORPORATE">Corporate</SelectItem>
                      <SelectItem value="SYSTEM_ADMIN">System Admin</SelectItem>
                    </SelectContent>
                  </Select>
                </td>
                <td className="py-3 px-4">
                  {user.enterprise ? (
                    <div className="flex items-center text-sm">
                      <Building2 className="h-4 w-4 mr-1 text-muted-foreground" />
                      {user.enterprise.name}
                    </div>
                  ) : (
                    <span className="text-sm text-muted-foreground">—</span>
                  )}
                </td>
                <td className="py-3 px-4">
                  {user.subscription ? (
                    <span className="px-2 py-1 text-xs font-medium bg-blue-100 text-blue-800 rounded-full">
                      {user.subscription.tier}
                    </span>
                  ) : (
                    <span className="text-sm text-muted-foreground">—</span>
                  )}
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
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {filteredUsers.length === 0 && (
        <div className="text-center py-8 text-muted-foreground">
          No users found
        </div>
      )}
    </div>
  );
}
