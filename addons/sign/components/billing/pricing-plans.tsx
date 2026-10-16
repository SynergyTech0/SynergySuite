'use client';

import { useState } from 'react';
import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { CheckCircle } from 'lucide-react';

interface BillingInfo {
  status: string;
}

interface PricingPlansProps {
  currentBillingStatus?: string;
}

export function PricingPlans({ currentBillingStatus = 'Inactive' }: PricingPlansProps) {
  const { data: session } = useSession();
  const [billingCycle, setBillingCycle] = useState<'monthly' | 'quarterly' | 'annual'>('monthly');
  const router = useRouter();

  const pricingPlans = [
    {
      name: 'Basic',
      price: {
        monthly: '$9.99',
        quarterly: '$29.99',
        annual: '$119.99'
      },
      features: [
        '5 documents per month',
        'Up to 3 signers per document',
        'Basic templates',
        'Email support'
      ],
      isCurrent: session?.user?.subscription?.tier === 'BASIC'
    },
    {
      name: 'Pro',
      price: {
        monthly: '$29.99',
        quarterly: '$89.99',
        annual: '$359.99'
      },
      features: [
        'Unlimited documents',
        'Unlimited signers',
        'Advanced templates',
        'AI features',
        'Priority support',
        'Custom branding'
      ],
      isCurrent: session?.user?.subscription?.tier === 'PRO',
      popular: true
    },
    {
      name: 'Enterprise',
      price: {
        monthly: 'Custom',
        quarterly: 'Custom',
        annual: 'Custom'
      },
      features: [
        'Everything in Pro',
        'Dedicated account manager',
        'Custom integrations',
        'SLA guarantee',
        'Advanced analytics',
        'SSO authentication'
      ],
      isCurrent: session?.user?.subscription?.tier === 'ENTERPRISE'
    }
  ];

  const currentPlanIndex = pricingPlans.findIndex(plan => plan.isCurrent);

  const handleUpgrade = (plan: string) => {
    if (plan === 'Enterprise') {
      router.push('/dashboard/billing/enterprise-contact');
    } else {
      router.push(`/dashboard/billing/upgrade?plan=${plan.toLowerCase()}&cycle=${billingCycle}`);
    }
  };

  return (
    <div>
      <div className="flex justify-between items-center mb-6">
        <h2 className="text-2xl font-bold text-gray-900 mb-4">Available Plans</h2>
        
        {/* Billing Cycle Selector */}
        <div className="inline-flex rounded-lg border p-1 bg-gray-100">
          <button
            onClick={() => setBillingCycle('monthly')}
            className={`px-4 py-2 rounded-md text-sm font-medium transition-all ${
              billingCycle === 'monthly'
                ? 'bg-white shadow-sm text-gray-900'
                : 'text-gray-600 hover:text-gray-900'
            }`}
          >
            Monthly
          </button>
          <button
            onClick={() => setBillingCycle('quarterly')}
            className={`px-4 py-2 rounded-md text-sm font-medium transition-all ${
              billingCycle === 'quarterly'
                ? 'bg-white shadow-sm text-gray-900'
                : 'text-gray-600 hover:text-gray-900'
            }`}
          >
            Quarterly
          </button>
          <button
            onClick={() => setBillingCycle('annual')}
            className={`px-4 py-2 rounded-md text-sm font-medium transition-all ${
              billingCycle === 'annual'
                ? 'bg-white shadow-sm text-gray-900'
                : 'text-gray-600 hover:text-gray-900'
            }`}
          >
            Annual
          </button>
        </div>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {pricingPlans.map((plan, index) => (
          <Card key={plan.name} className={plan.popular ? 'border-blue-600 border-2' : ''}>
            <div className="h-full flex flex-col justify-start">
              {plan.popular && (
                <div className="bg-blue-600 text-white text-center py-2 text-sm font-medium">
                  Most Popular
                </div>
              )}
              <CardHeader>
                <CardTitle className="flex items-center justify-between">
                  {plan.name}
                  {plan.isCurrent && (
                    <Badge variant="outline">Current</Badge>
                  )}
                </CardTitle>
                <div className="mt-4">
                  <span className="text-4xl font-bold">{plan.price[billingCycle]}</span>
                  <span className="text-gray-600">{" / " + billingCycle}</span>
                </div>
              </CardHeader>
              <CardContent className='flex-grow'>
                <ul className="space-y-3 mb-6">
                  {plan.features.map((feature, index) => (
                    <li key={index} className="flex items-start space-x-2">
                      <CheckCircle className="w-5 h-5 text-green-600 flex-shrink-0 mt-0.5" />
                      <span className="text-gray-700">{feature}</span>
                    </li>
                  ))}
                </ul>
              </CardContent>
              <CardFooter>
                <Button 
                  className="w-full" 
                  variant={plan.isCurrent ? 'outline' : 'default'}
                  disabled={(plan.isCurrent || currentPlanIndex > index) && currentBillingStatus === 'ACTIVE'}
                  onClick={() => handleUpgrade(plan.name)}
                >
                  {plan.isCurrent ? 'Current Plan' : plan.name === 'Enterprise' ? 'Contact Sales' : 'Upgrade'}
                </Button>
              </CardFooter>
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}
