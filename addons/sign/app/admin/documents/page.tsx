import { prisma } from '@/lib/db';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { FileText, CheckCircle, Clock, XCircle } from 'lucide-react';

export const dynamic = 'force-dynamic';

type DocumentStatusCount = {
  status: string;
  _count: { _all: number } | number;
};

type DocumentWithRelations = {
  id: string;
  title: string;
  status: string;
  createdAt: Date;
  sender: {
    name: string | null;
    email: string | null;
  } | null;
  signers: {
    id: string;
  }[];
};

export default async function AdminDocumentsPage() {
  const [documents, stats] = await Promise.all([
    prisma.document.findMany({
      include: {
        sender: {
          select: {
            name: true,
            email: true,
          },
        },
        signers: {
          select: {
            id: true,
          },
        },
      },
      orderBy: {
        createdAt: 'desc',
      },
      take: 50,
    }),
    prisma.document.groupBy({
      by: ['status'],
      _count: {
        _all: true,
      },
    }),
  ]);

  // ✅ Type-safe reduce fix
  const statusStats = (stats as DocumentStatusCount[]).reduce(
    (acc: Record<string, number>, stat) => {
      const count =
        typeof stat._count === 'number' ? stat._count : stat._count._all;
      acc[stat.status] = count;
      return acc;
    },
    {}
  );

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold">Document Management</h1>
        <p className="text-muted-foreground mt-1">
          View and manage all documents across the platform
        </p>
      </div>

      {/* Stats */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Draft</CardTitle>
            <Clock className="h-4 w-4 text-yellow-600" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{statusStats.DRAFT || 0}</div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Sent</CardTitle>
            <FileText className="h-4 w-4 text-blue-600" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{statusStats.SENT || 0}</div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Completed</CardTitle>
            <CheckCircle className="h-4 w-4 text-green-600" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {statusStats.COMPLETED || 0}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Declined</CardTitle>
            <XCircle className="h-4 w-4 text-red-600" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {statusStats.DECLINED || 0}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Documents Table */}
      <Card>
        <CardHeader>
          <CardTitle>Recent Documents</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b">
                  <th className="text-left py-3 px-4">Title</th>
                  <th className="text-left py-3 px-4">Sender</th>
                  <th className="text-left py-3 px-4">Status</th>
                  <th className="text-left py-3 px-4">Signers</th>
                  <th className="text-left py-3 px-4">Created</th>
                </tr>
              </thead>
              <tbody>
                {(documents as DocumentWithRelations[]).map((doc) => (
                  <tr key={doc.id} className="border-b hover:bg-muted/50">
                    <td className="py-3 px-4 font-medium">{doc.title}</td>
                    <td className="py-3 px-4">
                      <div>
                        <div className="text-sm">{doc.sender?.name}</div>
                        <div className="text-xs text-muted-foreground">
                          {doc.sender?.email}
                        </div>
                      </div>
                    </td>
                    <td className="py-3 px-4">
                      <span
                        className={`px-2 py-1 text-xs font-medium rounded-full ${
                          doc.status === 'COMPLETED'
                            ? 'bg-green-100 text-green-800'
                            : doc.status === 'SENT'
                            ? 'bg-blue-100 text-blue-800'
                            : doc.status === 'DECLINED'
                            ? 'bg-red-100 text-red-800'
                            : 'bg-gray-100 text-gray-800'
                        }`}
                      >
                        {doc.status}
                      </span>
                    </td>
                    <td className="py-3 px-4">{doc.signers.length}</td>
                    <td className="py-3 px-4 text-sm text-muted-foreground">
                      {new Date(doc.createdAt).toLocaleDateString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
