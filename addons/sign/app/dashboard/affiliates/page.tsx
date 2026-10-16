
'use client';

import { useEffect, useState } from 'react';
import { useSession } from "@/lib/session-client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { 
  Copy, 
  DollarSign, 
  Users, 
  TrendingUp,
  CheckCircle2,
  Clock,
  XCircle,
  ArrowLeft
} from 'lucide-react';
import { toast } from 'react-hot-toast';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import Link from 'next/link';

interface AffiliateDashboardData {
  referralCode: string;
  referralLink: string;
  totalReferrals: number;
  activeReferrals: number;
  totalEarnings: number;
  pendingEarnings: number;
  nextPayoutDate: string;
  hasPaymentInfo: boolean;
  payoutMethod: string;
  referrals: Array<{
    id: string;
    email: string;
    name: string;
    createdAt: string;
    isActive: boolean;
    tier: string;
  }>;
  recentPayouts: Array<{
    id: string;
    amount: number;
    weekStart: string;
    weekEnd: string;
    status: string;
    processedAt: string;
    transactionId: string;
  }>;
}

export default function AffiliateDashboardPage() {
  const { data: session } = useSession() || {};
  const [data, setData] = useState<AffiliateDashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [paymentDialogOpen, setPaymentDialogOpen] = useState(false);
  const [paymentInfo, setPaymentInfo] = useState({
    payoutMethod: 'stripe',
    payoutEmail: '',
    stripeAccountId: ''
  });

  useEffect(() => {
    fetchDashboardData();
  }, []);

  const fetchDashboardData = async () => {
    try {
      const res = await fetch('/api/affiliates/dashboard');
      if (res.ok) {
        const data = await res.json();
        setData(data);
        setPaymentInfo({
          payoutMethod: data.payoutMethod || 'stripe',
          payoutEmail: '',
          stripeAccountId: ''
        });
      }
    } catch (error) {
      console.error('Error fetching dashboard:', error);
      toast.error('Failed to load affiliate dashboard');
    } finally {
      setLoading(false);
    }
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    toast.success('Copied to clipboard!');
  };

  const savePaymentInfo = async () => {
    try {
      const res = await fetch('/api/affiliates/payment-info', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(paymentInfo)
      });

      if (res.ok) {
        toast.success('Payment information saved successfully!');
        setPaymentDialogOpen(false);
        fetchDashboardData();
      } else {
        toast.error('Failed to save payment information');
      }
    } catch (error) {
      console.error('Error saving payment info:', error);
      toast.error('Failed to save payment information');
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary"></div>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="p-8">
        <p>Failed to load affiliate dashboard</p>
      </div>
    );
  }

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'COMPLETED':
        return <Badge className="bg-green-500"><CheckCircle2 className="w-3 h-3 mr-1" />Completed</Badge>;
      case 'PROCESSING':
        return <Badge className="bg-blue-500"><Clock className="w-3 h-3 mr-1" />Processing</Badge>;
      case 'PENDING':
        return <Badge className="bg-yellow-500"><Clock className="w-3 h-3 mr-1" />Pending</Badge>;
      case 'FAILED':
        return <Badge variant="destructive"><XCircle className="w-3 h-3 mr-1" />Failed</Badge>;
      default:
        return <Badge>{status}</Badge>;
    }
  };

  return (
    <div className="p-8 space-y-8">
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
            <h1 className="text-3xl font-bold mb-2">Affiliate Program</h1>
            <p className="text-muted-foreground">
              Earn $2 per month for every active paid referral. Payouts are processed automatically every Friday.
            </p>
          </div>
        </div>
      </div>

      {/* Payment Info Warning */}
      {!data.hasPaymentInfo && (
        <Card className="border-orange-500 bg-orange-50 dark:bg-orange-950">
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="font-semibold mb-1">Add Payment Information</h3>
                <p className="text-sm text-muted-foreground">
                  You need to add your payment information to receive automatic weekly payouts.
                </p>
              </div>
              <Dialog open={paymentDialogOpen} onOpenChange={setPaymentDialogOpen}>
                <DialogTrigger asChild>
                  <Button>Add Payment Info</Button>
                </DialogTrigger>
                <DialogContent>
                  <DialogHeader>
                    <DialogTitle>Add Payment Information</DialogTitle>
                    <DialogDescription>
                      Configure how you want to receive your affiliate payouts.
                    </DialogDescription>
                  </DialogHeader>
                  <div className="space-y-4 pt-4">
                    <div className="space-y-2">
                      <Label>Payout Method</Label>
                      <Select
                        value={paymentInfo.payoutMethod}
                        onValueChange={(value) => setPaymentInfo({ ...paymentInfo, payoutMethod: value })}
                      >
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="stripe">Stripe (Automatic)</SelectItem>
                          <SelectItem value="paypal">PayPal (Manual)</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>

                    {paymentInfo.payoutMethod === 'stripe' && (
                      <div className="space-y-2">
                        <Label>Stripe Connected Account ID</Label>
                        <Input
                          placeholder="acct_..."
                          value={paymentInfo.stripeAccountId}
                          onChange={(e) => setPaymentInfo({ ...paymentInfo, stripeAccountId: e.target.value })}
                        />
                        <p className="text-xs text-muted-foreground">
                          <a href="https://connect.stripe.com/express_login" target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">
                            Create a Stripe Express account
                          </a> to receive automatic payouts.
                        </p>
                      </div>
                    )}

                    {paymentInfo.payoutMethod === 'paypal' && (
                      <div className="space-y-2">
                        <Label>PayPal Email</Label>
                        <Input
                          type="email"
                          placeholder="your@email.com"
                          value={paymentInfo.payoutEmail}
                          onChange={(e) => setPaymentInfo({ ...paymentInfo, payoutEmail: e.target.value })}
                        />
                        <p className="text-xs text-muted-foreground">
                          PayPal payouts are processed manually and may take longer.
                        </p>
                      </div>
                    )}

                    <Button onClick={savePaymentInfo} className="w-full">
                      Save Payment Information
                    </Button>
                  </div>
                </DialogContent>
              </Dialog>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Stats Cards */}
      <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Earnings</CardTitle>
            <DollarSign className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">${data.totalEarnings.toFixed(2)}</div>
            <p className="text-xs text-muted-foreground">All-time earnings</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Pending Earnings</CardTitle>
            <TrendingUp className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">${data.pendingEarnings.toFixed(2)}</div>
            <p className="text-xs text-muted-foreground">Next payout: {new Date(data.nextPayoutDate).toLocaleDateString()}</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Active Referrals</CardTitle>
            <Users className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{data.activeReferrals}</div>
            <p className="text-xs text-muted-foreground">Paying subscribers</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Referrals</CardTitle>
            <Users className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{data.totalReferrals}</div>
            <p className="text-xs text-muted-foreground">All signups</p>
          </CardContent>
        </Card>
      </div>

      {/* Referral Link */}
      <Card>
        <CardHeader>
          <CardTitle>Your Referral Link</CardTitle>
          <CardDescription>
            Share this link to earn $2/week for each active paid referral
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label>Referral Code</Label>
            <div className="flex gap-2">
              <Input value={data.referralCode} readOnly />
              <Button
                variant="outline"
                size="icon"
                onClick={() => copyToClipboard(data.referralCode)}
              >
                <Copy className="h-4 w-4" />
              </Button>
            </div>
          </div>

          <div className="space-y-2">
            <Label>Referral Link</Label>
            <div className="flex gap-2">
              <Input value={data.referralLink} readOnly />
              <Button
                variant="outline"
                size="icon"
                onClick={() => copyToClipboard(data.referralLink)}
              >
                <Copy className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Referrals List */}
      <Card>
        <CardHeader>
          <CardTitle>Your Referrals</CardTitle>
          <CardDescription>
            Users who signed up using your referral link
          </CardDescription>
        </CardHeader>
        <CardContent>
          {data.referrals.length === 0 ? (
            <p className="text-muted-foreground text-center py-8">
              No referrals yet. Start sharing your referral link!
            </p>
          ) : (
            <div className="space-y-4">
              {data.referrals.map((referral) => (
                <div key={referral.id} className="flex items-center justify-between p-4 border rounded-lg">
                  <div>
                    <p className="font-medium">{referral.name || referral.email}</p>
                    <p className="text-sm text-muted-foreground">
                      Joined {new Date(referral.createdAt).toLocaleDateString()}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge variant={referral.isActive ? 'default' : 'secondary'}>
                      {referral.tier}
                    </Badge>
                    {referral.isActive && (
                      <Badge className="bg-green-500">Active</Badge>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Recent Payouts */}
      <Card>
        <CardHeader>
          <CardTitle>Recent Payouts</CardTitle>
          <CardDescription>
            Your payout history
          </CardDescription>
        </CardHeader>
        <CardContent>
          {data.recentPayouts.length === 0 ? (
            <p className="text-muted-foreground text-center py-8">
              No payouts yet. Keep referring to earn!
            </p>
          ) : (
            <div className="space-y-4">
              {data.recentPayouts.map((payout) => (
                <div key={payout.id} className="flex items-center justify-between p-4 border rounded-lg">
                  <div>
                    <p className="font-medium">${payout.amount.toFixed(2)}</p>
                    <p className="text-sm text-muted-foreground">
                      Week of {new Date(payout.weekStart).toLocaleDateString()}
                    </p>
                    {payout.transactionId && (
                      <p className="text-xs text-muted-foreground">
                        ID: {payout.transactionId}
                      </p>
                    )}
                  </div>
                  <div>
                    {getStatusBadge(payout.status)}
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
