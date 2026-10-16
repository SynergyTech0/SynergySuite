
'use client';

import { useState, useEffect } from 'react';
import { useSession } from 'next-auth/react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Search, Plus, FileText, MoreVertical, Eye, Copy, Trash, View, ArrowUpFromDot, PencilRuler, ArrowLeft, CopyIcon } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import Link from 'next/link';
import { formatDistanceToNow } from 'date-fns';
import PaginationCombined from '@/components/ui/paginationCombined';
import { useRouter } from 'next/navigation';

export default function TemplatesPage() {
  const [templates, setTemplates] = useState<any[]>([]);
  
  const [searchQuery, setSearchQuery] = useState('');
  const [debouncedSearchQuery, setDebouncedSearchQuery] = useState(searchQuery);
  const [invalidate, setInvalidate] = useState(false);

  const [currentPage, setCurrentPage] = useState(1);
  const PAGE_SIZE = 30;
  const [totalPages, setTotalPages] = useState(1);

  const router = useRouter();

  useEffect(() => {
    // Fetch templates from API
    async function fetchTemplates() {
      const res = await fetch('/api/templates?query=' + encodeURIComponent(debouncedSearchQuery) + '&page=' + currentPage + '&limit=' + PAGE_SIZE);
      const data = await res.json();
      
      setTemplates(data.templates);
      setTotalPages(data.pagination.totalPages);
    }
    if (invalidate)
      setInvalidate(false);
    else
      fetchTemplates();
  }, [debouncedSearchQuery, currentPage, invalidate]);

  const handleDelete = async (id: string) => {
    if (!confirm('Are you sure you want to delete this template?')) return;

    try {
      const res = await fetch(`/api/templates/${id}/delete`, {
        method: 'DELETE',
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to delete template');

      // Optimistically update UI
      setTemplates((prev) => prev.filter((template) => template.id !== id));
    } catch (error) {
      console.error('Error deleting template:', error);
      alert('Failed to delete template');
    }
  };

  const handleView = async (id: string) => {
    // Navigate to template view page
    router.push(`/dashboard/templates/${id}`);
  };

  const handleUse = async (id: string) => {
    // Navigate to template use page
    // For now redirects to handleView
    await handleView(id);
  };

  const handleCopy = async (id: string) => {
    try {
      await fetch(`/api/templates/${id}/copy`, {
        method: 'POST',
      });
    } catch (error) {
      console.error('Error copying template:', error);
      alert('Failed to copy template');
    }

    setCurrentPage(1);
    setInvalidate(true);
  };

  // Debounce search input
  useEffect(() => {
    const handler = setTimeout(() => {
      setDebouncedSearchQuery(searchQuery);
    }, 300);

    return () => clearTimeout(handler);
  }, [searchQuery]);

  return (
    <div className="p-6 space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <div className="flex items-center space-x-4">
            <Link href="/dashboard">
              <Button
                variant="outline"
                className="px-4 py-6 text-lg font-semibold border-2 rounded-lg"
              >
                <ArrowLeft className="w-5 h-8 mr-2" /> Back
              </Button>
            </Link>
            <div className='flex-flex-col'>
              <h1 className="text-3xl font-bold text-gray-900">Templates</h1>
              <p className="text-gray-600 mt-1">Create and manage reusable document templates</p>
            </div>
          </div>
        </div>
        <Link href="/dashboard/templates/create">
          <Button>
            <Plus className="w-4 h-4 mr-2" />
            Create Template
          </Button>
        </Link>
      </div>

      <Card>
        <CardContent className="pt-6">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-4 h-4" />
            <Input
              placeholder="Search templates..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-10"
            />
          </div>
        </CardContent>
      </Card>

      {templates.length === 0 ? (
        <Card>
          <CardContent className="py-12">
            <div className="text-center">
              <FileText className="w-12 h-12 text-gray-400 mx-auto mb-4" />
              <h3 className="text-lg font-medium text-gray-900 mb-2">No templates found</h3>
              <p className="text-gray-600 mb-6">
                {searchQuery ? 'Try adjusting your search' : 'Create your first template to get started'}
              </p>
              {!searchQuery && (
                <Link href="/dashboard/templates/create">
                  <Button>
                    <Plus className="w-4 h-4 mr-2" />
                    Create Template
                  </Button>
                </Link>
              )}
            </div>
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {templates.map((template) => (
            <Card key={template.id} className="hover:shadow-md transition-shadow">
              <CardContent className="p-6">
                <div className="flex items-start justify-between mb-4">
                  <div className="bg-blue-100 p-3 rounded-lg">
                    <FileText className="w-6 h-6 text-blue-600" />
                  </div>
                  <div className="">
                    <Button variant="outline" size="sm" onClick={() => handleUse(template.id)}>
                      <ArrowUpFromDot className="w-4 h-4 mr-2" />
                      Use Template
                    </Button>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="sm">
                          <MoreVertical className="w-4 h-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem onClick={() => handleView(template.id)}>
                          <Eye className="w-4 h-4 mr-2" />
                          View
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={() => handleCopy(template.id)}>
                          <CopyIcon className="w-4 h-4 mr-2" />
                          Copy
                        </DropdownMenuItem>
                        <DropdownMenuItem className="text-red-600" onClick={() => handleDelete(template.id)}>
                          <Trash className="w-4 h-4 mr-2" />
                          Delete
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                </div>
                <h3 className="font-semibold text-gray-900 mb-2">{template.name}</h3>
                <p className="text-sm text-gray-600 mb-4">{template.description}</p>
                <p className="text-sm text-gray-500 mb-4">Created by {template.creator.name}</p>
                <div className="flex items-center justify-between text-sm">
                  <Badge variant="outline">Used {template.usageCount}x</Badge>
                  <span className="text-gray-500">
                    {formatDistanceToNow(new Date(template.createdAt), { addSuffix: true })}
                  </span>
                </div>
                </CardContent>
              </Card>
            ))}
        </div>
      )}
      <PaginationCombined
        currentPage={currentPage}
        totalPages={totalPages}
        setCurrentPage={setCurrentPage}
      />
    </div>
  );
}
