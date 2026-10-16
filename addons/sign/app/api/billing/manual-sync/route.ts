import { NextResponse } from "next/server";
import { stripe, STRIPE_PRICING } from "@/lib/stripe";
import { prisma } from "@/lib/prisma";
import { SubscriptionStatus, SubscriptionTier } from "@prisma/client";

/**
 * Manual subscription sync endpoint for test mode
 * This is a workaround for local development where webhooks can't reach localhost
 * In production, webhooks handle this automatically
 */
export async function POST(req: Request) {
  try {
    const { session_id } = await req.json();

    if (!session_id) {
      return NextResponse.json({ error: "Missing session_id" }, { status: 400 });
    }

    // Retrieve the checkout session
    const checkout = await stripe.checkout.sessions.retrieve(session_id, {
      expand: ["customer", "subscription", "line_items.data.price.product"],
    });

    if (checkout.payment_status !== "paid") {
      return NextResponse.json(
        { error: "Checkout session not paid", status: checkout.payment_status },
        { status: 400 }
      );
    }

    // Find the user
    const customerId =
      typeof checkout.customer === "string"
        ? checkout.customer
        : checkout.customer?.id;
    const userIdFromRef = checkout.client_reference_id || checkout.metadata?.userId;

    let user = null as any;
    if (customerId) {
      user = await prisma.user.findFirst({
        where: { stripeAccountId: customerId },
        include: { subscription: true },
      });
    }
    if (!user && userIdFromRef) {
      user = await prisma.user.findUnique({
        where: { id: userIdFromRef },
        include: { subscription: true },
      });
    }

    if (!user) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    // Get subscription details
    const subscriptionId =
      typeof checkout.subscription === "string"
        ? checkout.subscription
        : (checkout.subscription as any)?.id;

    if (!subscriptionId) {
      return NextResponse.json(
        { error: "No subscription found in checkout session" },
        { status: 400 }
      );
    }

    // Fetch the subscription from Stripe
    const stripeSubscription = await stripe.subscriptions.retrieve(subscriptionId);
    const priceId = stripeSubscription.items.data[0]?.price.id;

    // Determine tier from price ID
    let tier: "BASIC" | "PRO" = "BASIC";

    // Check Pro tier price IDs
    if (
      priceId === process.env.STRIPE_PRO_PRICE_ID ||
      priceId === process.env.STRIPE_PRO_MONTHLY_PRICE_ID ||
      priceId === process.env.STRIPE_PRO_QUARTERLY_PRICE_ID ||
      priceId === process.env.STRIPE_PRO_ANNUAL_PRICE_ID
    ) {
      tier = "PRO";
    }
    // Check Basic tier price IDs
    else if (
      priceId === process.env.STRIPE_BASIC_PRICE_ID ||
      priceId === process.env.STRIPE_BASIC_MONTHLY_PRICE_ID ||
      priceId === process.env.STRIPE_BASIC_QUARTERLY_PRICE_ID ||
      priceId === process.env.STRIPE_BASIC_ANNUAL_PRICE_ID
    ) {
      tier = "BASIC";
    } else {
      // Check using STRIPE_PRICING object
      for (const [tierName, cycles] of Object.entries(STRIPE_PRICING)) {
        if (Object.values(cycles).includes(priceId)) {
          tier = tierName as "BASIC" | "PRO";
          break;
        }
      }
    }

    // Calculate period dates from Stripe subscription
    const currentPeriodStart =
      stripeSubscription.current_period_start
        ? new Date(stripeSubscription.current_period_start * 1000)
        : new Date();
    const currentPeriodEnd =
      stripeSubscription.current_period_end
        ? new Date(stripeSubscription.current_period_end * 1000)
        : new Date(Date.now() + 30 * 24 * 60 * 60 * 1000); // Default to 30 days

    // Check if there's a pending tier and apply it if we're at period end
    const existingSubscription = user.subscription;
    let finalTier = tier;

    if (existingSubscription?.pendingTier && existingSubscription?.currentPeriodEnd) {
      const now = new Date();
      const periodEnd = new Date(existingSubscription.currentPeriodEnd);

      // If we're at the end of the period, apply the pending tier
      if (now >= periodEnd) {
        finalTier = existingSubscription.pendingTier as "BASIC" | "PRO";
        console.log(`✅ Applying pending tier change to ${finalTier} for user ${user.id}`);
      }
    }

    // Update or create subscription in database
    await prisma.subscription.upsert({
      where: { userId: user.id },
      update: {
        tier: finalTier as SubscriptionTier,
        status: "ACTIVE" as SubscriptionStatus,
        stripeSubscriptionId: subscriptionId,
        stripePriceId: priceId,
        currentPeriodStart,
        currentPeriodEnd,
        pendingTier: null, // Clear pending tier after applying
      },
      create: {
        userId: user.id,
        tier: finalTier as SubscriptionTier,
        status: "ACTIVE" as SubscriptionStatus,
        stripeSubscriptionId: subscriptionId,
        stripePriceId: priceId,
        currentPeriodStart,
        currentPeriodEnd,
      },
    });

    // Update user's Stripe account ID if not set
    if (!user.stripeAccountId && customerId) {
      await prisma.user.update({
        where: { id: user.id },
        data: { stripeAccountId: customerId },
      });
    }

    console.log(`✅ Manually synced subscription for user ${user.id} to ${tier}`);

    return NextResponse.json({
      success: true,
      userId: user.id,
      tier,
      subscriptionId,
      message: "Subscription synced successfully",
    });
  } catch (error) {
    console.error("Manual sync error:", error);
    return NextResponse.json(
      { error: "Failed to sync subscription", details: (error as Error).message },
      { status: 500 }
    );
  }
}
