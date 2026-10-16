
'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent } from '@/components/ui/card';
import { useEffect } from 'react';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import Link from 'next/link';
import { Search, UserPlus, Mail, FileText, ArrowLeft } from 'lucide-react';

interface SignerStats {
  id: string | null;
  name: string;
  email: string;
  companyName: string | null;
  image: string | null;
  documentsCount: number;
  completedCount: number;
  pendingCount: number;
}

export default function SignersPage() {
  const [searchQuery, setSearchQuery] = useState('');
  const [signers, setSigners] = useState<SignerStats[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchSigners = async () => {
      try {
        const response = await fetch('/api/signers/stats');
        if (response.ok) {
          const data = await response.json();
          setSigners(data.signers);
        }
      } catch (error) {
        console.error('Failed to fetch signers:', error);
      } finally {
        setLoading(false);
      }
    };
    
    fetchSigners();
  }, []);

  const filteredSigners = signers.filter(s => 
    s.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    s.email.toLowerCase().includes(searchQuery.toLowerCase())
  );

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
            <div className="flex flex-col">
              <h1 className="text-3xl font-bold text-gray-900">Signers</h1>
              <p className="text-gray-600 mt-1">Manage people who sign your documents</p>
            </div>
          </div>
        </div>
        <Link href="/dashboard/signers/add">
          <Button>
            <UserPlus className="w-4 h-4 mr-2" />
            Add Signer
          </Button>
        </Link>
      </div>

      <Card>
        <CardContent className="pt-6">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-4 h-4" />
            <Input
              placeholder="Search signers..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-10"
            />
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-4">
        {filteredSigners.map((signer) => (
          <Card key={signer.id + signer.email}>
            <CardContent className="p-6">
              <div className="flex items-center justify-between">
                <div className="flex items-center space-x-4">
                  <Avatar className="h-12 w-12">
                    <AvatarFallback className="bg-blue-100 text-blue-600 font-semibold">
                      {signer.name.split(' ').map(n => n[0].toUpperCase()).join('')}
                    </AvatarFallback>
                  </Avatar>
                  <div>
                    <h3 className="font-semibold text-gray-900">{signer.name}</h3>
                    <p className="text-sm text-gray-600 flex items-center space-x-1">
                      <Mail className="w-3 h-3" />
                      <span>{signer.email}</span>
                    </p>
                  </div>
                </div>
                <div className="flex items-center space-x-6">
                  <div className="text-center">
                    <p className="text-2xl font-bold text-gray-900">{signer.documentsCount}</p>
                    <p className="text-sm text-gray-600">Total</p>
                  </div>
                  <div className="text-center">
                    <p className="text-2xl font-bold text-yellow-600">{signer.pendingCount}</p>
                    <p className="text-sm text-gray-600">Pending</p>
                  </div>
                  <div className="text-center">
                    <p className="text-2xl font-bold text-green-600">{signer.completedCount}</p>
                    <p className="text-sm text-gray-600">Completed</p>
                  </div>
                  <Link href="/dashboard/signers/profile/[email]" as={`/dashboard/signers/profile/${encodeURIComponent(signer.email)}`}>
                    <Button variant="outline">View Documents</Button>
                  </Link>
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
