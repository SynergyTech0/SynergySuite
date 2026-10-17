import { NextResponse } from "next/server";
import { getServerSession } from "@/lib/auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { stripe } from "@/lib/stripe";

export async function POST() {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Load user + subscription
    const user = await prisma.user.findUnique({
      where: { id: session.user.id },
      include: { subscription: true },
    }) as any;

    if (!user) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    // Guard: must have active subscription
    if (!user.subscription || user.subscription.status !== "ACTIVE") {
      return NextResponse.json({ error: "No active subscription to cancel" }, { status: 400 });
    }

    const stripeSubId = user.subscription.stripeSubscriptionId;

    if (stripeSubId) {
      // Set subscription to cancel at period end (no immediate termination)
      const updated = await stripe.subscriptions.update(stripeSubId, {
        cancel_at_period_end: true,
      });

      // Update DB subscription record (keep status ACTIVE until period end)
      await prisma.subscription.update({
        where: { userId: user.id },
        data: {
          status: user.subscription.status, // remain ACTIVE (or TRIAL) until end
          cancelAtPeriodEnd: true,
          currentPeriodEnd: updated.ended_at ? new Date(updated.ended_at * 1000) : user.subscription.currentPeriodEnd,
        },
      });
    } else {
      throw new Error("No Stripe subscription ID found for user");
    }

    return NextResponse.json({ success: true, cancelAtPeriodEnd: true });
  } catch (err) {
    console.error("/api/billing/cancel-subscription error", err);
    return NextResponse.json({ error: "Cancellation failed" }, { status: 500 });
  }
}
