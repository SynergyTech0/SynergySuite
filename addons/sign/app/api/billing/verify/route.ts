import { NextResponse } from "next/server";
import { stripe } from "@/lib/stripe";
import { prisma } from "@/lib/prisma";

export async function POST(req: Request) {
  try {
    const { session_id } = await req.json().catch(() => ({}));
    const url = new URL(req.url);
    const sid = session_id || url.searchParams.get("session_id");

    if (!sid) {
      return NextResponse.json({ error: "Missing session_id" }, { status: 400 });
    }

    // Retrieve the Checkout Session to verify
    const checkout = await stripe.checkout.sessions.retrieve(sid as string, {
      expand: ["customer", "subscription", "line_items.data.price.product"],
    });

    if (checkout.payment_status !== "paid") {
      return NextResponse.json(
        { error: "Checkout session not paid", status: checkout.payment_status },
        { status: 400 }
      );
    }

  // Resolve the user via customer or client_reference_id metadata
    const customerId = (typeof checkout.customer === "string" ? checkout.customer : checkout.customer?.id) || undefined;
    const userIdFromRef = (checkout.client_reference_id as string | null) || (checkout.metadata?.userId as string | undefined);

    let user = null as any;
    if (customerId) {
      user = await prisma.user.findFirst({ where: { stripeAccountId: customerId }, include: { subscription: true } });
    }
    if (!user && userIdFromRef) {
      user = await prisma.user.findUnique({ where: { id: userIdFromRef }, include: { subscription: true } });
    }

    if (!user) {
      return NextResponse.json({ error: "User not found for session" }, { status: 404 });
    }

    // Determine expected plan from Stripe subscription/price (no DB writes here)
    const subscriptionId = (typeof checkout.subscription === "string" ? checkout.subscription : (checkout.subscription as any)?.id) as string | undefined;

    let priceId: string | undefined;
    let currentPeriodStart: Date | undefined;
    let currentPeriodEnd: Date | undefined;

    if (subscriptionId) {
      const subscription = await stripe.subscriptions.retrieve(subscriptionId) as any;
      priceId = subscription.items.data[0]?.price.id;
      currentPeriodStart = new Date(subscription.current_period_start * 1000);
      currentPeriodEnd = new Date(subscription.current_period_end * 1000);
    } else if (checkout.line_items?.data?.[0]?.price?.id) {
      priceId = checkout.line_items.data[0].price!.id as string;
    }

    // Map priceId -> expected tier (check all billing cycles)
    let expectedTier: "BASIC" | "PRO" | null = null;

    // Check Pro tier price IDs
    if (
      priceId === process.env.STRIPE_PRO_PRICE_ID ||
      priceId === process.env.STRIPE_PRO_MONTHLY_PRICE_ID ||
      priceId === process.env.STRIPE_PRO_QUARTERLY_PRICE_ID ||
      priceId === process.env.STRIPE_PRO_ANNUAL_PRICE_ID
    ) {
      expectedTier = "PRO";
    }
    // Check Basic tier price IDs
    else if (
      priceId === process.env.STRIPE_BASIC_PRICE_ID ||
      priceId === process.env.STRIPE_BASIC_MONTHLY_PRICE_ID ||
      priceId === process.env.STRIPE_BASIC_QUARTERLY_PRICE_ID ||
      priceId === process.env.STRIPE_BASIC_ANNUAL_PRICE_ID
    ) {
      expectedTier = "BASIC";
    }

    // Read current DB subscription (verification only, no writes)
    const dbSubscription = await prisma.subscription.findUnique({
      where: { userId: user.id },
      select: {
        tier: true,
        status: true,
        currentPeriodEnd: true,
        stripeSubscriptionId: true,
        stripePriceId: true,
      },
    });

    const synced = Boolean(
      dbSubscription &&
      (!expectedTier || dbSubscription.tier === expectedTier) &&
      (!subscriptionId || dbSubscription.stripeSubscriptionId === subscriptionId) &&
      (!priceId || dbSubscription.stripePriceId === priceId)
    );

    return NextResponse.json({
      success: true,
      userId: user.id,
      // What Stripe says we should have
      expected: {
        tier: expectedTier,
        priceId,
        subscriptionId,
        currentPeriodEnd: currentPeriodEnd ?? null,
      },
      // What the DB currently has
      dbSubscription,
      synced,
    });
  } catch (err) {
    console.error("/api/billing/verify error", err);
    return NextResponse.json({ error: "Verification failed" }, { status: 500 });
  }
}
