// app/api/billing/subscription/set/route.tsx
import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import {
  createCheckoutSession,
  createOrGetCustomer,
  getPriceId,
  BillingCycle,
  SubscriptionTier,
} from "@/lib/stripe";

export async function POST(req: Request) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { plan, billingCycle = "monthly" } = await req.json();

    if (!["basic", "pro"].includes(plan?.toLowerCase())) {
      return NextResponse.json({ error: "Invalid plan" }, { status: 400 });
    }

    const user = await prisma.user.findUnique({
      where: { id: session.user.id },
      include: { subscription: true },
    });

    if (!user?.email) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    // Ensure customer exists
    if (!user.stripeAccountId) {
      const customer = await createOrGetCustomer(user.email, user.name || "", user.id);
      await prisma.user.update({
        where: { id: user.id },
        data: { stripeAccountId: customer.id },
      });
      user.stripeAccountId = customer.id;
    }

    const priceId = getPriceId(
      plan.toUpperCase() as SubscriptionTier,
      billingCycle.toLowerCase() as BillingCycle
    );

    if (!priceId) {
      console.error("Missing Stripe price ID for", plan, billingCycle);
      return NextResponse.json(
        { success: false, error: `Price ID not configured for ${plan} ${billingCycle}` },
        { status: 500 }
      );
    }

    const baseUrl = process.env.NEXT_PUBLIC_SITE_URL || process.env.NEXTAUTH_URL || "http://localhost:3000";

    console.log("Creating checkout session:", {
      customerId: user.stripeAccountId,
      priceId,
      userId: user.id,
      baseUrl
    });

    const checkoutSession = await createCheckoutSession(
      user.stripeAccountId!,
      priceId,
      user.id,
      `${baseUrl}/dashboard/billing/upgrade/success?session_id={CHECKOUT_SESSION_ID}`,
      `${baseUrl}/dashboard/billing/upgrade/cancel`
    );

    console.log("Checkout session created:", checkoutSession.id);

    return NextResponse.json({
      success: true,
      sessionId: checkoutSession.id,
      url: checkoutSession.url
    });

  } catch (error: any) {
    console.error("STRIPE CHECKOUT ERROR:", error);
    console.error("Error details:", {
      message: error?.message,
      type: error?.type,
      code: error?.code,
      statusCode: error?.statusCode
    });

    return NextResponse.json(
      {
        success: false,
        error: error?.message || "Checkout failed",
        details: process.env.NODE_ENV === 'development' ? error?.message : undefined
      },
      { status: 500 }
    );
  }
}
