import { NextResponse } from 'next/server';
import { prisma as db } from '@/lib/db';
import Stripe from 'stripe';

// Helper function to get Stripe instance
function getStripeClient() {
  if (!process.env.STRIPE_SECRET_KEY) {
    throw new Error('STRIPE_SECRET_KEY not configured');
  }
  return new Stripe(process.env.STRIPE_SECRET_KEY, {
    apiVersion: '2024-11-20.acacia' as Stripe.StripeConfig['apiVersion'],
  });
}

// Helper function to get week boundaries for payout record
function getWeekBoundaries(date: Date) {
  const weekStart = new Date(date);
  const dayOfWeek = weekStart.getDay();
  // Friday is day 5, so we go back to the most recent Friday
  const daysToFriday = (dayOfWeek + 2) % 7;
  weekStart.setDate(weekStart.getDate() - daysToFriday);
  weekStart.setHours(0, 0, 0, 0);

  const weekEnd = new Date(weekStart);
  weekEnd.setDate(weekStart.getDate() + 6);
  weekEnd.setHours(23, 59, 59, 999);

  return { weekStart, weekEnd };
}

// This endpoint runs automatically via cron job every Friday
// Processes all UNPAID monthly earnings that have accumulated
export async function POST(req: Request) {
  try {
    // Verify cron secret
    const authHeader = req.headers.get('authorization');
    if (!process.env.CRON_SECRET || authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { weekStart, weekEnd } = getWeekBoundaries(new Date());

    console.log(`Processing payouts for Friday ${weekStart.toISOString()}`);

    // Step 1: Get all unpaid earnings (these were created by the monthly cron job)
    const unpaidEarnings = await db.affiliateEarning.findMany({
      where: {
        isPaid: false,
      },
      include: {
        affiliate: true,
      },
    });

    // Step 2: Group earnings by affiliate
    const earningsByAffiliate = unpaidEarnings.reduce((acc, earning) => {
      if (!acc[earning.affiliateId]) {
        acc[earning.affiliateId] = [];
      }
      acc[earning.affiliateId].push(earning);
      return acc;
    }, {} as Record<string, typeof unpaidEarnings>);

    let totalPayoutsProcessed = 0;
    let totalAmount = 0;

    // Step 3: Process each affiliate's unpaid earnings
    for (const [affiliateId, earnings] of Object.entries(earningsByAffiliate)) {
      const affiliate = earnings[0].affiliate;
      const earningsAmount = earnings.reduce((sum, e) => sum + e.amount, 0);

      if (earningsAmount === 0) continue;

      // Create payout record
      const payout = await db.affiliatePayout.create({
        data: {
          userId: affiliateId,
          amount: earningsAmount,
          weekStart,
          weekEnd,
          status: 'PROCESSING',
          payoutMethod: affiliate.payoutMethod || 'stripe',
        },
      });

      // Stripe processing
      let transactionId: string | null = null;
      let failureReason: string | null = null;

      try {
        if (!affiliate.stripeAccountId && !affiliate.payoutEmail) {
          failureReason = 'No payment information configured';
          throw new Error(failureReason);
        }

        if (affiliate.payoutMethod === 'stripe' && affiliate.stripeAccountId) {
          const stripe = getStripeClient();

          // Stripe requires minimum $0.50
          if (earningsAmount < 0.50) {
            failureReason = 'Amount below Stripe minimum ($0.50)';
            throw new Error(failureReason);
          }

          const transfer = await stripe.transfers.create({
            amount: Math.round(earningsAmount * 100), // cents
            currency: 'usd',
            destination: affiliate.stripeAccountId,
            description: `SynergySign affiliate payout - ${earnings.length} referrals`,
          });
          transactionId = transfer.id;
        } else {
          failureReason = 'Manual payout required for non-Stripe methods';
          throw new Error(failureReason);
        }

        // Update payout → COMPLETED
        await db.affiliatePayout.update({
          where: { id: payout.id },
          data: {
            status: 'COMPLETED',
            transactionId,
            processedAt: new Date(),
          },
        });

        // Mark earnings paid
        await db.affiliateEarning.updateMany({
          where: {
            id: { in: earnings.map(e => e.id) },
          },
          data: {
            isPaid: true,
            payoutId: payout.id,
          },
        });

        // CRITICAL: Decrement pendingEarnings (this was missing!)
        await db.user.update({
          where: { id: affiliateId },
          data: {
            pendingEarnings: { decrement: earningsAmount },
          },
        });

        totalPayoutsProcessed++;
        totalAmount += earningsAmount;

        console.log(`✓ Processed payout for ${affiliate.email}: $${earningsAmount.toFixed(2)} (${earnings.length} referrals)`);
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        await db.affiliatePayout.update({
          where: { id: payout.id },
          data: {
            status: 'FAILED',
            failureReason: failureReason || errorMessage,
          },
        });
        console.error(`✗ Failed payout for ${affiliate.email}: ${errorMessage}`);
      }
    }

    return NextResponse.json({
      success: true,
      message: `Processed ${totalPayoutsProcessed} payouts totaling $${totalAmount}`,
      totalPayoutsProcessed,
      totalAmount,
      weekStart,
      weekEnd,
    });
  } catch (error: any) {
    console.error('Error in weekly payout processing:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

// Manual test endpoint
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const secret = searchParams.get('secret');
  if (!process.env.CRON_SECRET || secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  return POST(req);
}
