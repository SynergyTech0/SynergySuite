'use client';

import { useState, useEffect } from 'react';
import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
  Search,
  FileText,
  Eye,
  MoreVertical,
  Upload,
  Clock,
  Archive,
  Delete,
  UserPlus,
  DownloadIcon,
  ArrowLeft
} from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import Link from 'next/link';
import { formatDistanceToNow } from 'date-fns';
import PaginationCombined from '@/components/ui/paginationCombined';

// -----------------------------
// Type Definitions
// -----------------------------
interface Document {
  id: string;
  title: string;
  status: string;
  createdAt: string;
  updatedAt: string;
  aiSummary?: string | null;
  archived: boolean;
  sender: {
    name: string;
    email: string;
  };
  signers: Array<{
    id: string;
    email: string;
    status: string;
  }>;
}

// -----------------------------
// Main Component
// -----------------------------
export default function DocumentsPage() {
  const { data: session, status } = useSession() || {};
  const router = useRouter();
  const [documents, setDocuments] = useState<Document[]>([]);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState('all');
  const [analyzing, setAnalyzing] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [debouncedSearchQuery, setDebouncedSearchQuery] = useState(searchQuery);

  const DOCSPERPAGE = 40;

  // -----------------------------
  // Fetch documents
  // -----------------------------
  useEffect(() => {
    if (status === 'unauthenticated') {
      router.push('/auth/login');
    } else if (status === 'authenticated') {
      const fetchDocuments = async () => {
        try {
          const response = await fetch(`/api/documents?archived=true&limit=${DOCSPERPAGE}&page=${page}` + (debouncedSearchQuery.length > 0 ? `&query=${encodeURIComponent(debouncedSearchQuery)}` : '') + (statusFilter !== 'all' ? `&status=${encodeURIComponent(statusFilter)}` : ''));
          if (response.ok) {
            const data = await response.json();
            setDocuments(data.documents || []);
            setTotalPages(data.pagination.totalPages || 1);
            setPage(data.pagination.page || 1);
          }
        } catch (error) {
          console.error('Failed to fetch documents:', error);
        } finally {
          setLoading(false);
        }
      };

      fetchDocuments();
    }
  }, [status, router, page, debouncedSearchQuery, statusFilter]);

  useEffect(() => {
    const handler = setTimeout(() => {
      setDebouncedSearchQuery(searchQuery);
    }, 300);

    return () => {
      clearTimeout(handler);
    };
  }, [searchQuery]);


  // -----------------------------
  // Helpers for UI
  // -----------------------------
  const getStatusBadge = (status: string) => {
    const variants: Record<string, any> = {
      COMPLETED: 'default',
      IN_PROGRESS: 'secondary',
      CANCELLED: 'destructive',
      DRAFT: 'outline'
    };
    return (
      <Badge variant={variants[status] || 'outline'}>
        {status.replace('_', ' ')}
      </Badge>
    );
  };

  const handleDownload = async (id: string) => {
    try {
      const res = await fetch(`/api/documents/${id}/download`);
      if (!res.ok) {
        // Try to parse error response as JSON
        let errorMessage = 'Unknown error';
        try {
          const contentType = res.headers.get('content-type');
          if (contentType && contentType.includes('application/json')) {
            const error = await res.json();
            errorMessage = error.error || error.message || 'Unknown error';
          } else {
            errorMessage = await res.text();
          }
        } catch (parseErr) {
          console.error('Failed to parse error response:', parseErr);
          errorMessage = `Server error (${res.status})`;
        }
        console.error('Download failed:', errorMessage);
        alert(`Failed to download document: ${errorMessage}`);
        return;
      }

      // Get filename from Content-Disposition header if present
      const disposition = res.headers.get('Content-Disposition');
      let suggestedName = `document_${id}`;
      if (disposition && /filename="?([^";]+)"?/i.test(disposition)) {
        const match = disposition.match(/filename="?([^";]+)"?/i);
        if (match?.[1]) suggestedName = match[1];
      }

      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      const link = window.document.createElement('a');
      link.href = url;
      link.download = suggestedName;
      window.document.body.appendChild(link);
      link.click();
      window.document.body.removeChild(link);
      // Cleanup object URL
      setTimeout(() => window.URL.revokeObjectURL(url), 1000);
    } catch (err) {
      console.error('Download error:', err);
      alert(`Failed to download document: ${err instanceof Error ? err.message : 'An unexpected error occurred'}`);
    }
  };

  const handleAddSigners = (id: string) => {
    router.push(`/dashboard/signers/add?documentId=${id}`);
  }

  const handleArchive = async (id: string, archived: boolean) => {
    const ok = window.confirm(archived ? 'Unarchive this document?' : 'Move this document to archive?');
    if (!ok) return;
    
    try {
      // Try archive endpoint first (may not exist)
      const res = await fetch(`/api/documents/${id}/archive`, { method: 'PUT' });
      if (res.ok) {
        // Optimistically flip archived value and re-sort to match API ordering:
        // archived: asc (false first, then true), then createdAt: desc
        setDocuments(prev => {
          const updated = prev.map(d => d.id === id ? { ...d, archived: !d.archived } : d);
          return updated.sort((a, b) => {
            // Sort by archived status first so unarchived comes first
            if (a.archived !== b.archived) {
              return a.archived ? 1 : -1;
            }
            // Then sort by createdAt descending
            return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
          });
        });
        return;
      }

      // Fallback: PATCH status to DRAFT (or other) if archive endpoint missing
      const patchRes = await fetch(`/api/documents/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'DRAFT' }),
      });
      if (patchRes.ok) {
        // setDocuments(prev => prev.filter(d => d.id !== id));
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


// -----------------------------
// AI Document Analysis (Ollama-ready)
// -----------------------------
const analyzeDocument = async (docId: string) => {
  try {
    setAnalyzing(docId);

    const formData = new FormData();
    formData.append("documentId", docId);

    const res = await fetch("/api/documents/analyze", {
      method: "POST",
      body: formData,
    });

    if (!res.ok) {
      const err = await res.json().catch(() => null);
      console.error("AI Analysis API Error:", err);
      alert("❌ AI Analysis failed on server.");
      return;
    }

    const data = await res.json();

    // Backend (ollama version) returns:
    // { success: true, result, document }
    if (!data?.success || !data?.result) {
      alert("❌ AI returned no analysis result.");
      return;
    }

    // Update UI with new analysis summary
    setDocuments((prev) =>
      prev.map((doc) =>
        doc.id === docId
          ? {
              ...doc,
              aiSummary: data.document?.aiSummary ?? data.result,
              aiFullAnalysis: data.document?.aiFullAnalysis ?? data.result,
              aiAnalyzedAt: new Date().toISOString(),
            }
          : doc
      )
    );
  } catch (err) {
    console.error("AI analysis error:", err);
    alert("❌ Analysis request failed — see console.");
  } finally {
    setAnalyzing(null);
  }
};
  // -----------------------------
  // Render
  // -----------------------------
  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex justify-between items-center">
        <div className="flex items-center space-x-4">
          <Link href="/dashboard">
            <Button
              variant="outline"
              className="px-4 py-6 text-lg font-semibold border-2 rounded-lg"
            >
              <ArrowLeft className="w-5 h-8 mr-2" /> Back
            </Button>
          </Link>
          <div>
            <h1 className="text-3xl font-bold text-gray-900">Documents</h1>
            <p className="text-gray-600 mt-1">Manage and track all your documents</p>
          </div>
        </div>
        <Link href="/dashboard/documents/upload">
          <Button>
            <Upload className="w-4 h-4 mr-2" />
            Upload Document
          </Button>
        </Link>
      </div>

      {/* Filters */}
      <Card>
        <CardContent className="pt-6">
          <div className="flex flex-col md:flex-row gap-4">
            <div className="flex-1">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-4 h-4" />
                <Input
                  placeholder="Search documents..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="pl-10"
                />
              </div>
            </div>
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="w-full md:w-48">
                <SelectValue placeholder="Filter by status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Status</SelectItem>
                <SelectItem value="DRAFT">Draft</SelectItem>
                <SelectItem value="SENT">Sent</SelectItem>
                <SelectItem value="COMPLETED">Completed</SelectItem>
                <SelectItem value="DECLINED">Declined</SelectItem>
                <SelectItem value="EXPIRED">Expired</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      {/* Documents List */}
      {documents.length === 0 ? (
        <Card>
          <CardContent className="py-12">
            <div className="text-center">
              <FileText className="w-12 h-12 text-gray-400 mx-auto mb-4" />
              <h3 className="text-lg font-medium text-gray-900 mb-2">No documents found</h3>
              <p className="text-gray-600 mb-6">
                {searchQuery || statusFilter !== 'all'
                  ? 'Try adjusting your filters'
                  : 'Get started by uploading your first document'
                }
              </p>
              {!searchQuery && statusFilter === 'all' && (
                <Link href="/dashboard/documents/upload">
                  <Button>
                    <Upload className="w-4 h-4 mr-2" />
                    Upload Document
                  </Button>
                </Link>
              )}
            </div>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4">
          {documents.map((doc) => (
            <Card key={doc.id} className="hover:shadow-md transition-shadow">
              <CardContent className="p-6">
                <div className="flex items-start justify-between">
                  <div className="flex items-start space-x-4 flex-1">
                    {doc.archived ? (
                      <div className="bg-orange-100 p-3 rounded-lg">
                        <Archive className="w-6 h-6 text-orange-600" />
                      </div>
                    ):(
                      <div className="bg-blue-100 p-3 rounded-lg">
                        <FileText className="w-6 h-6 text-blue-600" />
                      </div>
                    )}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center space-x-3 mb-2">
                        <h3 className="text-lg font-semibold text-gray-900 truncate">
                          {doc.title}
                        </h3>
                        {getStatusBadge(doc.status)}
                      </div>
                      <div className="text-sm text-gray-600 space-y-1">
                        <p>Sent by: {doc.sender.name}</p>
                        <p>Signers: {doc.signers.length} | Signed: {doc.signers.filter(s => s.status === 'SIGNED').length}</p>
                        <p>Created {formatDistanceToNow(new Date(doc.createdAt), { addSuffix: true })}</p>
                      </div>

                      {/* Inline AI Summary */}
                      {doc.aiSummary && (
                        <div className="mt-3 border-t pt-2 text-sm bg-gray-50 rounded p-2">
                          <strong>AI Summary:</strong>
                          <div className="whitespace-pre-line text-gray-800">{doc.aiSummary}</div>
                        </div>
                      )}
                    </div>
                  </div>

                  <div className="flex items-center space-x-2">
                    <Link href={`/dashboard/documents/${doc.id}`}>
                      <Button variant="outline" size="sm">
                        <Eye className="w-4 h-4 mr-2" />
                        View
                      </Button>
                    </Link>

                    <Button
                      variant="secondary"
                      size="sm"
                      disabled={!!analyzing}
                      onClick={() => analyzeDocument(doc.id)}
                    >
                      {analyzing === doc.id ? (
                        <>
                          <Clock className="w-4 h-4 mr-2 animate-spin" /> Analyzing...
                        </>
                      ) : (
                        <>
                          <FileText className="w-4 h-4 mr-2" /> Analyze
                        </>
                      )}
                    </Button>

                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="sm">
                          <MoreVertical className="w-4 h-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">

                      <DropdownMenuItem onClick={() => handleDownload(doc.id)}>
                          <DownloadIcon className="mr-2 h-4 w-4" />
                          Download
                      </DropdownMenuItem>

                      <DropdownMenuItem onClick={() => handleAddSigners(doc.id)}>
                          <UserPlus className="mr-2 h-4 w-4" />
                          Add Signers
                      </DropdownMenuItem>

                      <DropdownMenuItem onClick={() => handleArchive(doc.id, doc.archived)}>
                        <span className="flex items-center text-orange-600 hover:text-orange-800">
                          <Archive className="mr-2 h-4 w-4" />
                          {doc.archived ? 'Unarchive' : 'Archive'}
                        </span>
                      </DropdownMenuItem>

                      <DropdownMenuItem onClick={() => handleDelete(doc.id)}>
                        <span className="flex items-center text-red-600">
                          <Delete className="mr-2 h-4 w-4" />
                          Delete
                        </span>
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
          <PaginationCombined
            currentPage={page}
            totalPages={totalPages}
            setCurrentPage={setPage}
          />
        </div>
      )}
    </div>
  );
}
