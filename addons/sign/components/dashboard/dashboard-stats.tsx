
'use client';

import { useEffect, useState } from 'react';
import { useSession } from 'next-auth/react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { FileText, Users, Clock, CheckCircle, Loader2 } from 'lucide-react';

/**
 * Dashboard stats plans
 * Component 1 - Doughnut Chart - Document Status Overview
 * Organize by: Completed, Pending, Complete, Expired
 * Needs: Agregate counts for each status, could be extracted elsewhere
 * 
 * Component 2 - Signing Trents Over Time - Line Chart
 * Organize by: Assigned, Signed, Completed over time
 * Group by day/week/month
 * Needs: Join all documents made by this user to document signers and aggregate status's over time
 * 
 * Component 3 - Time to Complete - Bar Chart
 * Organize by: Average time taken to complete documents
 * Group by day/week/month
 * Needs: Calculate time difference between document creation and completion for all documents created by this user
 * 
 */

interface StatsData {
  totalDocuments: number;
  pendingSignatures: number;
  completedDocuments: number;
  activeSigners: number;
}

export function DashboardStats({ statsData } : {statsData?: StatsData}) {
  const { data: session } = useSession();
  const [stats, setStats] = useState<StatsData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchStats = async () => {
      if (!session?.user?.id) return;

      if (statsData) {
        setStats(statsData);
        setLoading(false);
        return;
      }

      try {
        const response = await fetch('/api/dashboard/stats');
        if (response.ok) {
          const data = await response.json();
          setStats(data);
        }
      } catch (error) {
        console.error('Failed to fetch stats:', error);
      } finally {
        setLoading(false);
      }
    };

    fetchStats();
  }, [session?.user?.id]);

  if (loading) {
    return (
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        {Array.from({ length: 4 }).map((_, i) => (
          <Card key={i}>
            <CardContent className="p-6">
              <div className="flex items-center justify-center h-16">
                <Loader2 className="w-6 h-6 animate-spin text-gray-400" />
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    );
  }

  const statsCards = [
    {
      title: 'Total Documents',
      value: stats?.totalDocuments || 0,
      icon: FileText,
      color: 'text-blue-600',
      bgColor: 'bg-blue-100'
    },
    {
      title: 'Pending Signatures',
      value: stats?.pendingSignatures || 0,
      icon: Clock,
      color: 'text-orange-600',
      bgColor: 'bg-orange-100'
    },
    {
      title: 'Completed',
      value: stats?.completedDocuments || 0,
      icon: CheckCircle,
      color: 'text-green-600',
      bgColor: 'bg-green-100'
    },
    {
      title: 'Active Signers',
      value: stats?.activeSigners || 0,
      icon: Users,
      color: 'text-purple-600',
      bgColor: 'bg-purple-100'
    }
  ];

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
      {statsCards.map((card, index) => (
        <Card key={card.title} className="border-0 shadow-md hover:shadow-lg transition-shadow">
          <CardContent className="p-6">
            <div className="flex items-center space-x-4">
              <div className={`p-3 rounded-lg ${card.bgColor}`}>
                <card.icon className={`w-6 h-6 ${card.color}`} />
              </div>
              <div>
                <p className="text-sm font-medium text-gray-600">{card.title}</p>
                <p className="text-3xl font-bold text-gray-900">{card.value}</p>
              </div>
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

