import Stripe from "stripe";

// Paid plans are optional (the hosted product's billing; a suite runs without it). The client is
// made on first use, so the app starts and builds without STRIPE_SECRET_KEY and only the billing
// routes fail when it is missing.
let client: Stripe | null = null;

function stripeClient(): Stripe {
  if (!process.env.STRIPE_SECRET_KEY) throw new Error("Billing is off: STRIPE_SECRET_KEY is not set");
  return (client ??= new Stripe(process.env.STRIPE_SECRET_KEY, {
    apiVersion: "2024-11-20.acacia" as Stripe.StripeConfig["apiVersion"],
  }));
}

export const stripe = new Proxy({} as Stripe, {
  get: (_target, prop) => Reflect.get(stripeClient() as object, prop),
});

// Structured pricing configuration for all tiers and billing cycles
// Get these from Stripe Dashboard after creating products
// Format: price_xxxxxxxxxxxxx
export const STRIPE_PRICING = {
  BASIC: {
    monthly: process.env.STRIPE_BASIC_MONTHLY_PRICE_ID || "",
    quarterly: process.env.STRIPE_BASIC_QUARTERLY_PRICE_ID || "",
    annual: process.env.STRIPE_BASIC_ANNUAL_PRICE_ID || "",
    // 50% off launch special for annual
    annualLaunch: process.env.STRIPE_BASIC_ANNUAL_LAUNCH_PRICE_ID || "",
  },
  PRO: {
    monthly: process.env.STRIPE_PRO_MONTHLY_PRICE_ID || "",
    quarterly: process.env.STRIPE_PRO_QUARTERLY_PRICE_ID || "",
    annual: process.env.STRIPE_PRO_ANNUAL_PRICE_ID || "",
    // 50% off launch special for annual
    annualLaunch: process.env.STRIPE_PRO_ANNUAL_LAUNCH_PRICE_ID || "",
  },
  // Enterprise tier - yearly billing only
  // Price per seat per year ($49.99/month × 12 = $599.88/year per seat)
  // Minimum 25 seats required
  ENTERPRISE: {
    annual: process.env.STRIPE_ENTERPRISE_ANNUAL_PRICE_ID || "",
  },
} as const;

// Launch special flag - set to true to use 50% off annual pricing
export const USE_LAUNCH_PRICING = true;

// Enterprise pricing constants
export const ENTERPRISE_PRICING = {
  PRICE_PER_SEAT_PER_MONTH: 49.99,
  PRICE_PER_SEAT_PER_YEAR: 599.88, // $49.99 × 12 months
  MIN_SEATS: 25,
  MIN_ANNUAL_TOTAL: 14997, // 25 seats × $599.88 = $14,997/year
} as const;

// Helper type for billing cycles
export type BillingCycle = "monthly" | "quarterly" | "annual";
export type SubscriptionTier = keyof typeof STRIPE_PRICING;

// Helper function to get price ID by tier and billing cycle
export const getPriceId = (tier: SubscriptionTier, cycle: BillingCycle): string => {
  // Use launch special pricing for annual plans if enabled
  if (USE_LAUNCH_PRICING && cycle === "annual" && (tier === "BASIC" || tier === "PRO")) {
    const launchPrice = STRIPE_PRICING[tier].annualLaunch;
    if (launchPrice) {
      return launchPrice;
    }
  }
  return (STRIPE_PRICING[tier] as Record<string, string>)[cycle];
};

// Backwards compatibility - defaults to monthly
export const STRIPE_PRICES = {
  BASIC: STRIPE_PRICING.BASIC.monthly,
  PRO: STRIPE_PRICING.PRO.monthly,
} as const;

export const getStripeClient = () => stripe;

/**
 * Creates a Stripe Checkout Session for subscription
 * @param customerId - Stripe customer ID
 * @param priceId - Stripe price ID for the subscription plan
 * @param userId - User ID for metadata
 * @param successUrl - URL to redirect on successful payment
 * @param cancelUrl - URL to redirect on cancelled payment
 */
export const createCheckoutSession = async (
  customerId: string,
  priceId: string,
  userId: string,
  successUrl: string,
  cancelUrl: string
) => {
  const session = await stripe.checkout.sessions.create({
    customer: customerId,
    // Helpful to recover user context in webhooks
    client_reference_id: userId,
    line_items: [
      {
        price: priceId,
        quantity: 1,
      },
    ],
    mode: "subscription",
    success_url: successUrl,
    cancel_url: cancelUrl,
    metadata: {
      userId,
    },
    subscription_data: {
      metadata: {
        userId,
      },
    },
    // Security: Prevent the customer from modifying billing details during checkout
    allow_promotion_codes: true,
    billing_address_collection: "required",
    payment_method_collection: "always",
  });

  return session;
};

/**
 * Creates a Stripe customer or retrieves existing one
 * @param email - Customer email
 * @param name - Customer name
 * @param userId - User ID for metadata
 */
export const createOrGetCustomer = async (
  email: string,
  name: string,
  userId: string
) => {
  // Check if customer already exists
  const existingCustomers = await stripe.customers.list({
    email,
    limit: 1,
  });

  if (existingCustomers.data.length > 0) {
    return existingCustomers.data[0];
  }

  // Create new customer
  const customer = await stripe.customers.create({
    email,
    name,
    metadata: {
      userId,
    },
  });

  return customer;
};