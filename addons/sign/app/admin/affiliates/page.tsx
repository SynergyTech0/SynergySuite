
'use client';

import { useEffect, useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { 
  DollarSign, 
  Users, 
  TrendingUp,
  CheckCircle2,
  Clock,
  XCircle
} from 'lucide-react';
import { toast } from 'react-hot-toast';

interface AffiliateStats {
  totalAffiliates: number;
  totalReferrals: number;
  activeReferrals: number;
  payoutsThisMonth: {
    amount: number;
    count: number;
  };
  pendingPayouts: {
    amount: number;
    count: number;
  };
  topAffiliates: Array<{
    id: string;
    email: string;
    name: string;
    totalEarnings: number;
    totalReferrals: number;
  }>;
}

interface Affiliate {
  id: string;
  email: string;
  name: string;
  referralCode: string;
  totalEarnings: number;
  totalReferrals: number;
  activeReferrals: number;
  totalPayouts: number;
  hasPaymentInfo: boolean;
  payoutMethod: string;
  createdAt: string;
}

export default function AdminAffiliatesPage() {
  const [stats, setStats] = useState<AffiliateStats | null>(null);
  const [affiliates, setAffiliates] = useState<Affiliate[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchData();
  }, []);

  const fetchData = async () => {
    try {
      const [statsRes, affiliatesRes] = await Promise.all([
        fetch('/api/admin/affiliates/stats'),
        fetch('/api/admin/affiliates/list')
      ]);

      if (statsRes.ok && affiliatesRes.ok) {
        const statsData = await statsRes.json();
        const affiliatesData = await affiliatesRes.json();
        setStats(statsData);
        setAffiliates(affiliatesData.affiliates);
      }
    } catch (error) {
      console.error('Error fetching data:', error);
      toast.error('Failed to load affiliate data');
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary"></div>
      </div>
    );
  }

  if (!stats) {
    return (
      <div className="p-8">
        <p>Failed to load affiliate data</p>
      </div>
    );
  }

  return (
    <div className="p-8 space-y-8">
      <div>
        <h1 className="text-3xl font-bold mb-2">Affiliate Program Management</h1>
        <p className="text-muted-foreground">
          Monitor and manage your affiliate program. Payouts are processed automatically every Monday.
        </p>
      </div>

      {/* Stats Cards */}
      <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-5">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Affiliates</CardTitle>
            <Users className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats.totalAffiliates}</div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Referrals</CardTitle>
            <Users className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats.totalReferrals}</div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Active Referrals</CardTitle>
            <TrendingUp className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats.activeReferrals}</div>
            <p className="text-xs text-muted-foreground">Paid subscribers</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Payouts This Month</CardTitle>
            <DollarSign className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">${stats.payoutsThisMonth.amount.toFixed(2)}</div>
            <p className="text-xs text-muted-foreground">{stats.payoutsThisMonth.count} payouts</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Pending Payouts</CardTitle>
            <Clock className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">${stats.pendingPayouts.amount.toFixed(2)}</div>
            <p className="text-xs text-muted-foreground">{stats.pendingPayouts.count} pending</p>
          </CardContent>
        </Card>
      </div>

      {/* Top Affiliates */}
      <Card>
        <CardHeader>
          <CardTitle>Top Affiliates</CardTitle>
          <CardDescription>
            Highest earning affiliates
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            {stats.topAffiliates.map((affiliate, index) => (
              <div key={affiliate.id} className="flex items-center justify-between p-4 border rounded-lg">
                <div className="flex items-center gap-4">
                  <div className="flex items-center justify-center w-8 h-8 rounded-full bg-primary text-primary-foreground font-bold">
                    {index + 1}
                  </div>
                  <div>
                    <p className="font-medium">{affiliate.name || affiliate.email}</p>
                    <p className="text-sm text-muted-foreground">
                      {affiliate.totalReferrals} referrals
                    </p>
                  </div>
                </div>
                <div className="text-right">
                  <p className="font-bold text-lg">${affiliate.totalEarnings.toFixed(2)}</p>
                  <p className="text-sm text-muted-foreground">Total earnings</p>
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* All Affiliates */}
      <Card>
        <CardHeader>
          <CardTitle>All Affiliates</CardTitle>
          <CardDescription>
            Complete list of all affiliates
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            {affiliates.map((affiliate) => (
              <div key={affiliate.id} className="flex items-center justify-between p-4 border rounded-lg">
                <div className="space-y-1">
                  <p className="font-medium">{affiliate.name || affiliate.email}</p>
                  <p className="text-sm text-muted-foreground">
                    Code: {affiliate.referralCode} • Joined {new Date(affiliate.createdAt).toLocaleDateString()}
                  </p>
                  <div className="flex gap-2 mt-2">
                    {affiliate.hasPaymentInfo ? (
                      <Badge className="bg-green-500">
                        <CheckCircle2 className="w-3 h-3 mr-1" />
                        Payment Info Added
                      </Badge>
                    ) : (
                      <Badge variant="secondary">
                        <XCircle className="w-3 h-3 mr-1" />
                        No Payment Info
                      </Badge>
                    )}
                    {affiliate.payoutMethod && (
                      <Badge variant="outline">{affiliate.payoutMethod}</Badge>
                    )}
                  </div>
                </div>
                <div className="text-right space-y-1">
                  <p className="font-bold">${affiliate.totalEarnings.toFixed(2)}</p>
                  <p className="text-sm text-muted-foreground">
                    {affiliate.activeReferrals} active / {affiliate.totalReferrals} total
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {affiliate.totalPayouts} payouts
                  </p>
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Automatic Payout Info */}
      <Card>
        <CardHeader>
          <CardTitle>Automatic Payout System</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-2 text-sm">
            <p><strong>How it works:</strong></p>
            <ul className="list-disc list-inside space-y-1 text-muted-foreground">
              <li>Earnings are calculated automatically every Monday at 12:00 AM UTC</li>
              <li>Affiliates earn $2 per active paid referral per week</li>
              <li>Payouts are processed automatically via Stripe for configured accounts</li>
              <li>PayPal payouts require manual processing</li>
              <li>Affiliates must add their payment information to receive payouts</li>
            </ul>
            <p className="mt-4"><strong>Manual Test:</strong></p>
            <p className="text-muted-foreground">
              To manually trigger the payout cron job: <code className="bg-muted px-2 py-1 rounded">curl -X POST {window.location.origin}/api/cron/weekly-affiliate-payouts -H "Authorization: Bearer YOUR_CRON_SECRET"</code>
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
