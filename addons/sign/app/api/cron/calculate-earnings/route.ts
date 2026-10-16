import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";

/**
 * Monthly cron job to calculate affiliate earnings.
 * Should run on the 1st of each month.
 * Earnings are $2 per month per active paid referral.
 */
export async function GET(request: NextRequest) {
  try {
    const authHeader = request.headers.get("authorization");
    if (!process.env.CRON_SECRET || authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const now = new Date();
    const monthStart = getStartOfMonth(now);
    const monthEnd = getEndOfMonth(now);

    const usersWithReferrals = await prisma.user.findMany({
      where: {
        referrals: {
          some: {
            subscription: {
              status: "ACTIVE",
              tier: { not: "FREE" },
            },
          },
        },
      },
      include: {
        referrals: {
          where: {
            subscription: {
              status: "ACTIVE",
              tier: { not: "FREE" },
            },
          },
          include: { subscription: true },
        },
      },
    });

    let totalEarningsCreated = 0;
    let totalAmount = 0;

    for (const user of usersWithReferrals) {
      for (const referral of user.referrals) {
        const existing = await prisma.affiliateEarning.findUnique({
          where: {
            affiliateId_referredUserId_monthStart: {
              affiliateId: user.id,
              referredUserId: referral.id,
              monthStart,
            },
          },
        });

        if (!existing) {
          await prisma.affiliateEarning.create({
            data: {
              affiliateId: user.id,
              referredUserId: referral.id,
              amount: 2.0,
              monthStart,
              monthEnd,
              isPaid: false,
            },
          });

          await prisma.user.update({
            where: { id: user.id },
            data: {
              pendingEarnings: { increment: 2.0 },
              totalEarnings: { increment: 2.0 },
            },
          });

          totalEarningsCreated++;
          totalAmount += 2.0;
        }
      }
    }

    return NextResponse.json({
      success: true,
      message: `Created ${totalEarningsCreated} earnings totaling $${totalAmount.toFixed(2)}`,
      monthStart: monthStart.toISOString(),
      monthEnd: monthEnd.toISOString(),
    });
  } catch (err) {
    console.error("Error calculating affiliate earnings:", err);
    return NextResponse.json({ error: "Failed to calculate earnings" }, { status: 500 });
  }
}

/**
 * Manual trigger (admin override)
 */
export async function POST(request: NextRequest) {
  try {
    const { adminSecret } = await request.json();

    if (!process.env.ADMIN_SECRET || adminSecret !== process.env.ADMIN_SECRET) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Call GET directly with same NextRequest for simplicity
    request.headers.set("authorization", `Bearer ${process.env.CRON_SECRET}`);
    return GET(request);
  } catch (err) {
    console.error("Error in manual calculation:", err);
    return NextResponse.json({ error: "Failed to calculate earnings" }, { status: 500 });
  }
}

/**
 * Helpers
 */
function getStartOfMonth(date: Date) {
  const d = new Date(date);
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1, 0, 0, 0, 0));
}

function getEndOfMonth(date: Date) {
  const d = new Date(date);
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0, 23, 59, 59, 999));
}
