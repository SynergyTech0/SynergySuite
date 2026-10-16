
'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { FileSignature, Zap, Shield, Users, CheckCircle, Star, ArrowRight, Sparkles, Clock, Globe } from 'lucide-react';
import { LandingNav } from './reusables/landing-nav';
import { HomeHero } from './home/home-hero';
import { LandingCompliance } from './home/home-compliance';
import { LandingHowItWorks } from './home/home-how';
import { LandingFeatures } from './home/home-features';
import { LandingIndustry } from './home/home-industry';
import { LandingPrices } from './home/home-prices';
import { LandingCTA } from './home/home-cta';
import { LandingFooter } from './reusables/landing-footer';
import { useState } from 'react';
import { FeaturesHero } from './features/features-hero';
import { FeaturesGrid } from './features/features-grid';
import { FeaturesIndustry } from './features/features-industry';
import { PricingHero } from './pricing/pricing-hero';
import { PricingComparison } from './pricing/pricing-comparison';
import { PricingFAQ } from './pricing/pricing-faq';
import { PricingCTA } from './pricing/pricing-cta';
import { SecurityHero } from './security/security-hero';
import { SecurityGrid } from './security/security-grid';
import { SecurityEncryption } from './security/security-encryption';
import { SecurityCompliance } from './security/security-compliance';


export function LandingPage() {
  const [ page, setPage ] = useState<'home' | 'features' | 'pricing' | 'security'>('home');

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 via-white to-indigo-50">
      <LandingNav page={page} setPage={setPage} />

      {page === 'home' &&
        <>
          <HomeHero />
          <LandingCompliance />
          <LandingHowItWorks />
          <LandingFeatures />
          <LandingIndustry />
          <LandingPrices setPage={setPage} />
          <LandingCTA />
        </>
      }

      {page === 'features' &&
        <>
          <FeaturesHero />
          <FeaturesGrid />
          <FeaturesIndustry />
          <LandingCTA />
        </>
      }

      {page === 'pricing' &&
        <>
          <PricingHero />
          <PricingComparison />
          <PricingFAQ />
          <PricingCTA />
        </>
      }

      {page === 'security' &&
        <>
          <SecurityHero />
          <SecurityGrid />
          <SecurityEncryption />
          <SecurityCompliance />
          <LandingCTA />
        </>
      }

      <LandingFooter setPage={setPage} />
    </div>
  );
}

