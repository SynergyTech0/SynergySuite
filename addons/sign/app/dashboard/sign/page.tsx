
'use client';

import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Clock, PenTool } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { ArrowLeft } from 'lucide-react';
import Link from 'next/link';

interface pendingDocument {
  id: string;
  title: string;
  sender: { name: string; email: string };
  sentAt: string;
  deadline: string | null;
  token: string;
}

export default function SignPage() {
  const [pendingDocuments, setPendingDocuments] = useState<pendingDocument[]>([]);
  const [loading, setLoading] = useState<boolean>(true);

  useEffect(() => {
    setLoading(true);
    async function fetchPendingDocuments() {
      try {
        const response = await fetch('/api/signers/pending');
        if (!response.ok) {
          console.error('Fetch failed', response.status);
          return;
        }

        const data = await response.json();

        setPendingDocuments(data);
        setLoading(false);
      } catch (error) {
        console.error('Error fetching pending documents:', error);
      }
    }

    fetchPendingDocuments();
  }, []);

  if (loading || !pendingDocuments) {
    return (
      <div className="p-6">Loading...</div>
    );
  }

  function navigateToSign(token: string) {
    window.location.href = `/sign/${token}`;
  }

  return (
    <div className="p-6 space-y-6">
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
          <div className="flex flex-col">
            <h1 className="text-3xl font-bold mb-2">Sign Documents</h1>
            <p className="text-muted-foreground">
              Documents waiting for your signature
            </p>
          </div>
        </div>
      </div>

      {pendingDocuments.length === 0 ? (
        <Card>
          <CardContent className="py-12">
            <div className="text-center">
              <PenTool className="w-12 h-12 text-gray-400 mx-auto mb-4" />
              <h3 className="text-lg font-medium text-gray-900 mb-2">No pending documents</h3>
              <p className="text-gray-600">
                You don't have any documents waiting for your signature
              </p>
            </div>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4">
          {pendingDocuments.map((doc) => (
            <Card key={doc.id} className="hover:shadow-md transition-shadow">
              <CardContent className="p-6">
                <div className="flex items-start justify-between">
                  <div className="flex items-start space-x-4 flex-1">
                    <div className="bg-yellow-100 p-3 rounded-lg">
                      <PenTool className="w-6 h-6 text-yellow-600" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center space-x-3 mb-2">
                        <h3 className="text-lg font-semibold text-gray-900">{doc.title}</h3>
                        <Badge variant="secondary">
                          <Clock className="w-3 h-3 mr-1" />
                          Pending
                        </Badge>
                      </div>
                      <div className="text-sm text-gray-600 space-y-1">
                        <p>From: {doc.sender.name} ({doc.sender.email})</p>
                        <p>Sent {formatDistanceToNow(new Date(doc.sentAt), { addSuffix: true })}</p>
                        {doc.deadline &&
                          <p className="text-yellow-600 font-medium">
                            Due {formatDistanceToNow(new Date(doc.deadline), { addSuffix: true })}
                          </p>
                        }
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center space-x-2">
                    <Button size="sm" onClick={() => navigateToSign(doc.token)}>
                      <PenTool className="w-4 h-4 mr-2" />
                      Sign Now
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
