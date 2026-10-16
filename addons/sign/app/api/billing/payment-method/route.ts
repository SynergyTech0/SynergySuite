import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { stripe } from "@/lib/stripe";

export async function GET() {
  try {
    const session = await getServerSession(authOptions);

    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Get user with subscription details
    const user = await prisma.user.findUnique({
      where: { id: session.user.id },
      include: {
        subscription: true,
      },
    });

    if (!user) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    // If no Stripe customer ID, return empty payment method info
    if (!user.stripeAccountId) {
      return NextResponse.json({
        hasPaymentMethod: false,
        subscription: user.subscription,
      });
    }

    // Retrieve customer's payment methods from Stripe
    const paymentMethods = await stripe.paymentMethods.list({
      customer: user.stripeAccountId,
      type: "card",
      limit: 1,
    });

    // If user has an active subscription, get the default payment method from it
    let defaultPaymentMethod = null;
    if (user.subscription?.stripeSubscriptionId) {
      try {
        const subscription = await stripe.subscriptions.retrieve(
          user.subscription.stripeSubscriptionId
        );

        if (subscription.default_payment_method) {
          const paymentMethodId =
            typeof subscription.default_payment_method === "string"
              ? subscription.default_payment_method
              : subscription.default_payment_method.id;

          defaultPaymentMethod = await stripe.paymentMethods.retrieve(
            paymentMethodId
          );
        }

        // Use the default payment method from subscription, or fall back to the first available
        const paymentMethod = defaultPaymentMethod || paymentMethods.data[0];

        if (!paymentMethod || paymentMethod.type !== "card") {
          return NextResponse.json({
            hasPaymentMethod: false,
            subscription: user.subscription,
          });
        }

        // Extract card details
        const card = paymentMethod.card;

        // Response subscription status
        const userSubscription = {
          cancelAtPeriodEnd: subscription.cancel_at_period_end,
          status: subscription.status.toUpperCase(),
          tier: user.subscription.tier,
          pendingTier: user.subscription.pendingTier,
          currentPeriodEnd: user.subscription.currentPeriodEnd,
        }

        return NextResponse.json({
          hasPaymentMethod: true,
          paymentMethod: {
            id: paymentMethod.id,
            brand: card?.brand || "unknown",
            last4: card?.last4 || "****",
            expMonth: card?.exp_month,
            expYear: card?.exp_year,
          },
          subscription: userSubscription,
        });
      } catch (error) {
        console.error("Error retrieving subscription payment method:", error);
        // If error retrieving subscription, fall through to checking payment methods
      }
    }

    // If no subscription or error retrieving it, check for any payment methods
    const paymentMethod = paymentMethods.data[0];
    if (!paymentMethod || paymentMethod.type !== "card") {
      return NextResponse.json({
        hasPaymentMethod: false,
        subscription: user.subscription,
      });
    }

    // Extract card details
    const card = paymentMethod.card;

    return NextResponse.json({
      hasPaymentMethod: true,
      paymentMethod: {
        id: paymentMethod.id,
        brand: card?.brand || "unknown",
        last4: card?.last4 || "****",
        expMonth: card?.exp_month,
        expYear: card?.exp_year,
      },
      subscription: user.subscription,
    });
  } catch (error) {
    console.error("Error fetching payment method:", error);
    return NextResponse.json(
      { error: "Failed to fetch payment method" },
      { status: 500 }
    );
  }
}
