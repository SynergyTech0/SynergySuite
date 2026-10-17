'use client';

import { useEffect, useState } from 'react';
import { useSession } from "@/lib/session-client";
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
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
import { CreditCard } from 'lucide-react';
import { format } from 'date-fns';
import { useRouter, useSearchParams } from 'next/navigation';
import { useToast } from '@/hooks/use-toast';

interface CurrentPlanCardProps {
  onBillingStatusChange?: (status: string) => void;
}

export function CurrentPlanCard({ onBillingStatusChange }: CurrentPlanCardProps) {
  const { data: session } = useSession();
  const [loading, setLoading] = useState(true);
  const [updateLoading, setUpdateLoading] = useState(false);
  const [cancelLoading, setCancelLoading] = useState(false);
  const [showUpdateDialog, setShowUpdateDialog] = useState(false);
  const [showCancelDialog, setShowCancelDialog] = useState(false);
  const router = useRouter();
  const searchParams = useSearchParams();
  const { toast } = useToast();

  const [currentBillingInfo, setCurrentBillingInfo] = useState({
    plan: session?.user?.subscription?.tier || 'Free',
    status: session?.user?.subscription?.status || 'Inactive',
    nextBillingDate: new Date(Date.now()),
    cardBrand: 'Visa',
    last4: '****',
    expMonth: 12,
    expYear: 2035,
    pendingTier: null as string | null,
  });

  useEffect(() => {
    const fetchBillingInfo = async () => {
      if (!session?.user) return;

      try {
        const response = await fetch('/api/billing/payment-method');
        if (!response.ok) {
          console.error('Failed to fetch payment method');
          return;
        }

        const data = await response.json();
        let billingStatus = 'Inactive';
        if (data.subscription) {
          if (data.subscription.cancelAtPeriodEnd === true) {
            billingStatus = 'CANCELLED';
          } else {
            billingStatus = data.subscription.status || 'Active';
          }
        }

        setCurrentBillingInfo({
          plan: data.subscription?.tier || 'Free',
          status: billingStatus,
          nextBillingDate:
            (data.subscription?.currentPeriodEnd
            ? new Date(data.subscription.currentPeriodEnd)
            : new Date(Date.now())),
          cardBrand: data.paymentMethod?.brand || 'Unknown',
          last4: data.paymentMethod?.last4 || '****',
          expMonth: data.paymentMethod?.expMonth || 12,
          expYear: data.paymentMethod?.expYear || 2024,
          pendingTier: data.subscription?.pendingTier || null,
        });

        onBillingStatusChange?.(billingStatus);
        setLoading(false);
      } catch (error) {
        console.error('Error fetching billing info:', error);
      }
    };

    fetchBillingInfo();
  }, [session]);

  useEffect(() => {
    if (searchParams.get('payment_method_updated') === 'true') {
      toast({
        title: "Payment Method Updated",
        description: "Your payment method has been successfully updated.",
      });
      router.replace('/dashboard/billing');
    }
  }, [searchParams, router, toast]);

  const handleUpdatePaymentMethod = async () => {
    setUpdateLoading(true);
    try {
      const response = await fetch('/api/billing/setup-payment-method', {
        method: 'POST',
      });

      if (!response.ok) {
        throw new Error('Failed to create setup session');
      }

      const data = await response.json();
      
      if (data.url) {
        window.location.href = data.url;
      }
    } catch (error) {
      console.error('Error updating payment method:', error);
      toast({
        title: "Error",
        description: "Failed to initiate payment method update. Please try again.",
        variant: "destructive",
      });
      setUpdateLoading(false);
    }
  };

  const handleCancelSubscription = async () => {
    setCancelLoading(true);
    try {
      const res = await fetch('/api/billing/cancel-subscription', { method: 'POST' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to cancel');
      toast({ title: 'Subscription Cancelled', description: 'Your subscription has been cancelled.' });
      setCurrentBillingInfo(prev => ({ ...prev, status: 'CANCELLED' }));
      onBillingStatusChange?.('CANCELLED');
      setShowCancelDialog(false);
    } catch (err) {
      console.error('Cancel error', err);
      toast({ title: 'Error', description: 'Failed to cancel subscription.', variant: 'destructive' });
    } finally {
      setCancelLoading(false);
    }
  };

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle>Current Plan</CardTitle>
          <CardDescription>Your active subscription details</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex items-start justify-between">
            <div className="space-y-2">
              <div className="flex items-center space-x-3">
                {loading ? (
                  <div className='animate-pulse bg-gray-300 w-20 h-6 rounded-xl'></div>
                ) : (
                  <h3 className="text-2xl font-bold text-gray-900">
                    {currentBillingInfo.plan} Plan
                  </h3>  
                )}
                {loading ? (
                  <div className='animate-pulse bg-gray-300 w-20 h-6 rounded-xl'></div>
                ) : (
                  <Badge className={currentBillingInfo.status === 'ACTIVE' ? 'bg-green-100 text-green-800 hover:bg-green-200' : 'bg-red-100 text-red-800 hover:bg-red-200'}>
                    {currentBillingInfo.status}
                  </Badge>
                )}
              </div>
              <div className="flex space-x-4 items-center">
                {currentBillingInfo.status === 'CANCELLED' ? (
                  <>
                  <p className="text-gray-600">
                    Subscription will end on: 
                  </p>
                  {loading ? (<div className='animate-pulse bg-gray-300 w-40 h-6 rounded-xl'></div>) : (<span>{format(currentBillingInfo.nextBillingDate, 'PPP')}</span>)}
                  </>
                ) : currentBillingInfo.status === 'ACTIVE' ? (
                  <>
                  <p className="text-gray-600">
                  Next billing date:
                  </p>
                  {loading ? (<div className='animate-pulse bg-gray-300 w-40 h-6 rounded-xl'></div>) : (<span>{format(currentBillingInfo.nextBillingDate, 'PPP')}</span>)}
                  </>
                ) : (
                  <p>No billing information available</p>
                )}
              </div>
              <div className="flex items-center space-x-2 text-sm text-gray-600">
                <CreditCard className="w-4 h-4" />
                {loading ? (
                  <span className='animate-pulse'>•••• •••• •••• ••••</span>
                ) : (
                  <span>•••• •••• •••• {currentBillingInfo.last4}</span>
                )}
              </div>
              {currentBillingInfo.pendingTier && !loading && (
                <div className="mt-3 p-3 bg-yellow-50 border border-yellow-200 rounded-lg">
                  <p className="text-sm text-yellow-800">
                    <strong>Scheduled Change:</strong> Your plan will change to <strong>{currentBillingInfo.pendingTier}</strong> on {format(currentBillingInfo.nextBillingDate, 'PPP')}
                  </p>
                </div>
              )}
            </div>
            <div className="space-x-2">
              <Button 
                variant="outline" 
                onClick={() => setShowUpdateDialog(true)}
                disabled={loading || currentBillingInfo.status !== 'ACTIVE'}
              >
                Update Payment Method
              </Button>
              <Button 
                variant="outline"
                onClick={() => setShowCancelDialog(true)}
                disabled={loading || currentBillingInfo.status !== 'ACTIVE'}
              >
                Cancel Subscription
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Update Payment Method Dialog */}
      <AlertDialog open={showUpdateDialog} onOpenChange={setShowUpdateDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Update Payment Method</AlertDialogTitle>
            <AlertDialogDescription>
              You'll be redirected to Stripe's secure checkout page to update your payment method.
              Your new payment method will be used for all future billing on your active subscription.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={updateLoading}>Cancel</AlertDialogCancel>
            <AlertDialogAction 
              onClick={handleUpdatePaymentMethod}
              disabled={updateLoading}
            >
              {updateLoading ? 'Redirecting...' : 'Continue to Stripe'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Cancel Subscription Dialog */}
      <AlertDialog open={showCancelDialog} onOpenChange={setShowCancelDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Cancel Subscription</AlertDialogTitle>
            <AlertDialogDescription>
              This will immediately cancel your active subscription. You may lose access to paid features right away along with access to your documents. Are you sure you want to proceed?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={cancelLoading}>Keep Subscription</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleCancelSubscription}
              disabled={cancelLoading}
              className='bg-red-600 hover:bg-red-700 click:bg-red-700'
            >
              {cancelLoading ? 'Cancelling...' : 'Confirm Cancellation'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
