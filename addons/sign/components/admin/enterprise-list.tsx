'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { useToast } from '@/hooks/use-toast';
import { Trash2, Edit, Search } from 'lucide-react';
import { Spinner } from '@/components/ui/spinner';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';

interface Enterprise {
  id: string;
  name: string;
  domain: string;
  contactEmail: string;
  customPricing: number | null;
  notes: string | null;
  isActive: boolean;
  _count: {
    users: number;
  };
}

export default function EnterpriseList({ initialEnterprises }: { initialEnterprises: Enterprise[] }) {
  const router = useRouter();
  const { toast } = useToast();
  const [enterprises, setEnterprises] = useState(initialEnterprises);
  const [searchTerm, setSearchTerm] = useState('');
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const filteredEnterprises = enterprises.filter((enterprise) =>
    enterprise.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    enterprise.domain.toLowerCase().includes(searchTerm.toLowerCase()) ||
    enterprise.contactEmail.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const handleDelete = async (id: string) => {
    setDeletingId(id);
    try {
      const response = await fetch(`/api/admin/enterprises/${id}`, {
        method: 'DELETE',
      });

      if (!response.ok) throw new Error('Failed to delete enterprise');

      setEnterprises(enterprises.filter((e) => e.id !== id));
      toast({
        title: 'Success',
        description: 'Enterprise deleted successfully',
      });
    } catch (error) {
      toast({
        title: 'Error',
        description: 'Failed to delete enterprise',
        variant: 'destructive',
      });
    } finally {
      setDeleteId(null);
      setDeletingId(null);
    }
  };

  const handleEdit = (id: string) => {
    router.push(`/admin/enterprises/${id}`);
  };

  return (
    <>
      <div className="mb-6">
        <div className="relative max-w-md">
          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 h-4 w-4" />
          <Input
            placeholder="Search enterprises..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="pl-10"
          />
        </div>
      </div>

      <div className="border rounded-lg">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Domain</TableHead>
              <TableHead>Contact Email</TableHead>
              <TableHead>Users</TableHead>
              <TableHead>Custom Pricing</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filteredEnterprises.length === 0 ? (
              <TableRow>
                <TableCell colSpan={7} className="text-center py-8 text-gray-500">
                  No enterprises found
                </TableCell>
              </TableRow>
            ) : (
              filteredEnterprises.map((enterprise) => (
                <TableRow key={enterprise.id}>
                  <TableCell className="font-medium">{enterprise.name}</TableCell>
                  <TableCell className="text-gray-600">{enterprise.domain}</TableCell>
                  <TableCell className="text-gray-600">{enterprise.contactEmail}</TableCell>
                  <TableCell>{enterprise._count.users}</TableCell>
                  <TableCell>
                    {enterprise.customPricing ? (
                      <span className="text-gray-600">${enterprise.customPricing}/month</span>
                    ) : (
                      <span className="text-gray-400">-</span>
                    )}
                  </TableCell>
                  <TableCell>
                    <Badge variant={enterprise.isActive ? 'default' : 'secondary'}>
                      {enterprise.isActive ? 'Active' : 'Inactive'}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-2">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => handleEdit(enterprise.id)}
                      >
                        <Edit className="h-4 w-4 mr-1" />
                        Edit
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => setDeleteId(enterprise.id)}
                        className="text-red-600 hover:text-red-700 hover:bg-red-50"
                        disabled={deletingId === enterprise.id}
                      >
                        {deletingId === enterprise.id ? (
                          <>
                            <Spinner size="sm" className="mr-1" />
                            Deleting...
                          </>
                        ) : (
                          <>
                            <Trash2 className="h-4 w-4 mr-1" />
                            Delete
                          </>
                        )}
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      <AlertDialog open={!!deleteId} onOpenChange={() => setDeleteId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Are you sure?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete this enterprise and remove all associated users from the enterprise.
              This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => deleteId && handleDelete(deleteId)}
              className="bg-red-600 hover:bg-red-700"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
