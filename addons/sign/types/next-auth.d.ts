/// <reference types="next-auth" />

import {
  UserRole,
  SubscriptionTier,
  SubscriptionStatus,
} from "@prisma/client";
import { DefaultSession, DefaultUser } from "next-auth";

declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      email: string;
      name?: string | null;
      role: UserRole;
      enterpriseId?: string | null;
      isEnterpriseAdmin?: boolean;
      verified: boolean;
      referralCode?: string;
      subscription?: {
        tier: SubscriptionTier;
        status: SubscriptionStatus;
        currentPeriodEnd?: Date | null;
      };
    } & DefaultSession["user"];
    accessToken?: string; // ✅ added for JWT access token support
  }

  interface User extends DefaultUser {
    id: string;
    email: string;
    name?: string | null;
    role: UserRole;
    enterpriseId?: string | null;
    isEnterpriseAdmin?: boolean;
    verified: boolean;
    referralCode?: string;
    subscription?: {
      tier: SubscriptionTier;
      status: SubscriptionStatus;
      currentPeriodEnd?: Date | null;
    };
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    userId?: string;
    email?: string;
    role: UserRole;
    enterpriseId?: string | null;
    isEnterpriseAdmin?: boolean;
    verified?: boolean;
    referralCode?: string;
    subscription?: {
      tier: SubscriptionTier;
      status: SubscriptionStatus;
      currentPeriodEnd?: Date | null;
    };
    accessToken?: string; // ✅ added so your callbacks compile cleanly
  }
}
