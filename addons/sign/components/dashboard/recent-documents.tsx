
'use client';

import { useEffect, useState } from 'react';
import { useSession } from "@/lib/session-client";
import Link from 'next/link';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { FileText, Clock, CheckCircle, XCircle, Eye, Download, MoreVertical, Archive, Share, Delete } from 'lucide-react';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { formatDistanceToNow } from 'date-fns';

interface Document {
  id: string;
  title: string;
  status: string;
  createdAt: string;
  sender: {
    name: string;
    email: string;
  };
  signers: Array<{
    name: string;
    email: string;
    status: string;
  }>;
  _count: {
    fields: number;
  };
}

interface RecentDocumentsProps {
  query?: string;
}

export function RecentDocuments({ query }: RecentDocumentsProps) {
  const { data: session } = useSession();
  const [documents, setDocuments] = useState<Document[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchDocuments = async () => {
      if (!session?.user?.id) return;

      try {
        const response = await fetch('/api/documents?limit=5' + (query ? `&query=${encodeURIComponent(query)}` : ''));
        if (response.ok) {
          const data = await response.json();
          setDocuments(data.documents || []);
        }
      } catch (error) {
        console.error('Failed to fetch documents:', error);
      } finally {
        setLoading(false);
      }
    };

    fetchDocuments();
  }, [session?.user?.id, query]);

  // ─── Actions: archive / delete ─────────────────────────
  const handleArchive = async (id: string) => {
    const ok = window.confirm('Move this document to archive?');
    if (!ok) return;
    try {
      // Try archive endpoint first (may not exist)
      const res = await fetch(`/api/documents/${id}/archive`, { method: 'PUT' });
      if (res.ok) {
        // remove from list optimistically
        setDocuments(prev => prev.filter(d => d.id !== id));
        return;
      }

      // Fallback: PATCH status to DRAFT (or other) if archive endpoint missing
      const patchRes = await fetch(`/api/documents/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'DRAFT' }),
      });
      if (patchRes.ok) {
        setDocuments(prev => prev.filter(d => d.id !== id));
      } else {
        console.error('Archive failed', await patchRes.text());
        alert('Failed to archive document');
      }
    } catch (err) {
      console.error('Archive error', err);
      alert('Failed to archive document');
    }
  };

  const handleDelete = async (id: string) => {
    const ok = window.confirm('Permanently delete this document? This cannot be undone.');
    if (!ok) return;
    try {
      const res = await fetch(`/api/documents/${id}/delete`, { method: 'DELETE' });
      if (res.ok) {
        // remove from list optimistically
        setDocuments(prev => prev.filter(d => d.id !== id));
      } else {
        console.error('Delete failed', await res.text());
        alert('Failed to delete document');
      }
    } catch (err) {
      console.error('Delete error', err);
      alert('Failed to delete document');
    }
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'COMPLETED':
        return <CheckCircle className="w-4 h-4 text-green-600" />;
      case 'SENT':
        return <Clock className="w-4 h-4 text-orange-600" />;
      case 'DECLINED':
        return <XCircle className="w-4 h-4 text-red-600" />;
      default:
        return <FileText className="w-4 h-4 text-gray-600" />;
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'COMPLETED':
        return 'bg-green-100 text-green-800';
      case 'SENT':
        return 'bg-orange-100 text-orange-800';
      case 'DECLINED':
        return 'bg-red-100 text-red-800';
      case 'DRAFT':
        return 'bg-gray-100 text-gray-800';
      default:
        return 'bg-blue-100 text-blue-800';
    }
  };

  if (loading) {
    return (
      <Card className="border-0 shadow-md">
        <CardHeader>
          <CardTitle>Recent Documents</CardTitle>
          <CardDescription>Your latest document activity</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="animate-pulse">
                <div className="h-16 bg-gray-200 rounded-lg"></div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="border-0 shadow-md">
      <CardHeader className="flex flex-row items-center justify-between">
        <div>
          <CardTitle className="flex items-center space-x-2">
            <FileText className="w-5 h-5 text-blue-600" />
            <span>Recent Documents</span>
          </CardTitle>
          <CardDescription>Your latest document activity</CardDescription>
        </div>
        <Link href="/dashboard/documents">
          <Button variant="outline" size="sm">
            View All
          </Button>
        </Link>
      </CardHeader>
      <CardContent>
        {documents.length === 0 ? (
          <div className="text-center py-8">
            <FileText className="w-12 h-12 text-gray-400 mx-auto mb-4" />
            <h3 className="text-lg font-medium text-gray-900 mb-2">No documents yet</h3>
            <p className="text-gray-600 mb-4">Get started by uploading your first document</p>
            <Link href="/dashboard/documents/upload">
              <Button>Upload Document</Button>
            </Link>
          </div>
        ) : (
          <div className="space-y-4">
            {documents.map((document) => (
              <div
                key={document.id}
                className="flex items-center justify-between p-4 border border-gray-200 rounded-lg hover:shadow-sm transition-shadow"
              >
                <div className="flex items-center space-x-4">
                  <div className="flex-shrink-0">
                    {getStatusIcon(document.status)}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center space-x-2 mb-1">
                      <p className="text-sm font-medium text-gray-900 truncate">
                        {document.title}
                      </p>
                      <Badge className={`text-xs ${getStatusColor(document.status)}`}>
                        {document.status}
                      </Badge>
                    </div>
                    <div className="flex items-center space-x-4 text-xs text-gray-500">
                      <span>By {document.sender.name}</span>
                      <span>•</span>
                      <span>{document.signers.length} signers</span>
                      <span>•</span>
                      <span>{formatDistanceToNow(new Date(document.createdAt))} ago</span>
                    </div>
                  </div>
                </div>

                <div className="flex items-center space-x-2">
                  <Link href={`/dashboard/documents/${document.id}`}>
                    <Button variant="ghost" size="sm">
                      <Eye className="w-4 h-4" />
                    </Button>
                  </Link>
                  
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="ghost" size="sm">
                        <MoreVertical className="w-4 h-4" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem onClick={() => handleArchive(document.id)}>
                        <span className="flex items-center text-orange-600 hover:text-orange-800">
                          <Archive className="mr-2 h-4 w-4" />
                          Archive
                        </span>
                      </DropdownMenuItem>

                      <DropdownMenuItem onClick={() => handleDelete(document.id)}>
                        <span className="flex items-center text-red-600">
                          <Delete className="mr-2 h-4 w-4" />
                          Delete
                        </span>
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

