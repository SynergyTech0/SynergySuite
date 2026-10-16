'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { ArrowLeft } from 'lucide-react';
import Link from 'next/link';
import { CurrentPlanCard } from '@/components/billing/current-plan-card';
import { PricingPlans } from '@/components/billing/pricing-plans';
import { InvoiceHistory } from '@/components/billing/invoice-history';

export default function BillingPage() {
  const [billingStatus, setBillingStatus] = useState<string>('Inactive');
  return (
    <div className="p-6 max-w-6xl mx-auto space-y-6">
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
          <h1 className="text-3xl font-bold text-gray-900">Billing & Subscription</h1>
          <p className="text-gray-600 mt-1">Manage your subscription and billing information</p>
        </div>
      </div>

      {/* Current Plan */}
      <CurrentPlanCard onBillingStatusChange={setBillingStatus} />

      {/* Available Plans */}
      <PricingPlans currentBillingStatus={billingStatus} />

      {/* Billing History */}
      <InvoiceHistory />
    </div>
  );
}
