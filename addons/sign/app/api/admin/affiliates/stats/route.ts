import { NextResponse } from 'next/server';
import { getServerSession } from "@/lib/auth";
import { authOptions } from '@/lib/auth';
import { prisma as db } from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const session = await getServerSession(authOptions);

    if (!session?.user?.email) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const user = await db.user.findUnique({
      where: { email: session.user.email },
    });

    if (user?.role !== 'ADMIN') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    // ✅ Get total affiliates (users with referral codes)
    const totalAffiliates = await db.user.count({
      where: {
        referralCode: {
          not: undefined, // fixed (was `not: null`)
        },
      },
    });

    // ✅ Get total referrals
    const totalReferrals = await db.user.count({
      where: {
        referredById: {
          not: undefined, // fixed (was `not: null`)
        },
      },
    });

    // ✅ Get active referrals (paid subscriptions)
    const activeReferrals = await db.user.count({
      where: {
        referredById: {
          not: undefined,
        },
        subscription: {
          status: 'ACTIVE',
          tier: {
            not: 'FREE',
          },
        },
      },
    });

    // ✅ Get total payouts this month
    const startOfMonth = new Date();
    startOfMonth.setDate(1);
    startOfMonth.setHours(0, 0, 0, 0);

    const payoutsThisMonth = await db.affiliatePayout.aggregate({
      where: {
        createdAt: {
          gte: startOfMonth,
        },
        status: 'COMPLETED',
      },
      _sum: {
        amount: true,
      },
      _count: true,
    });

    // ✅ Get pending payouts
    const pendingPayouts = await db.affiliatePayout.aggregate({
      where: {
        status: {
          in: ['PENDING', 'PROCESSING'],
        },
      },
      _sum: {
        amount: true,
      },
      _count: true,
    });

    // ✅ Get top affiliates
    const topAffiliates = await db.user.findMany({
      where: {
        referralCode: {
          not: undefined, // fixed (was `not: null`)
        },
      },
      select: {
        id: true,
        email: true,
        name: true,
        totalEarnings: true,
        _count: {
          select: {
            referrals: true,
          },
        },
      },
      orderBy: {
        totalEarnings: 'desc',
      },
      take: 10,
    });

    return NextResponse.json({
      totalAffiliates,
      totalReferrals,
      activeReferrals,
      payoutsThisMonth: {
        amount: payoutsThisMonth._sum.amount || 0,
        count: payoutsThisMonth._count,
      },
      pendingPayouts: {
        amount: pendingPayouts._sum.amount || 0,
        count: pendingPayouts._count,
      },
      topAffiliates: topAffiliates.map((a: any) => ({
        id: a.id,
        email: a.email,
        name: a.name,
        totalEarnings: a.totalEarnings,
        totalReferrals: a._count.referrals,
      })),
    });
  } catch (error: any) {
    console.error('Error fetching affiliate stats:', error);
    return NextResponse.json(
      { error: error.message },
      { status: 500 },
    );
  }
}
