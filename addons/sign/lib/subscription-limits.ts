
import { SubscriptionTier } from "@prisma/client";

export interface SubscriptionLimits {
  documentsPerMonth: number;
  signersPerDocument: number;
  templatesLimit: number;
  storageGB: number;
  prioritySupport: boolean;
  aiFeatures: boolean;
  customBranding: boolean;
}

export const subscriptionLimits: Record<SubscriptionTier, SubscriptionLimits> = {
  FREE: {
    documentsPerMonth: 3,
    signersPerDocument: 2,
    templatesLimit: 1,
    storageGB: 1,
    prioritySupport: false,
    aiFeatures: false,
    customBranding: false
  },
  BASIC: {
    documentsPerMonth: 20,
    signersPerDocument: 5,
    templatesLimit: 10,
    storageGB: 10,
    prioritySupport: false,
    aiFeatures: true,
    customBranding: false
  },
  PRO: {
    documentsPerMonth: 100,
    signersPerDocument: 10,
    templatesLimit: 50,
    storageGB: 50,
    prioritySupport: true,
    aiFeatures: true,
    customBranding: true
  },
  ENTERPRISE: {
    documentsPerMonth: -1, // Unlimited
    signersPerDocument: 20,
    templatesLimit: -1, // Unlimited
    storageGB: 500,
    prioritySupport: true,
    aiFeatures: true,
    customBranding: true
  }
};

export function getSubscriptionLimits(tier: SubscriptionTier): SubscriptionLimits {
  return subscriptionLimits[tier];
}

export function canPerformAction(
  tier: SubscriptionTier,
  currentUsage: number,
  limit: number
): boolean {
  if (limit === -1) return true; // Unlimited
  return currentUsage < limit;
}

