import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
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
      include: {
        referrals: {
          include: {
            subscription: true,
          },
        },
        affiliateEarnings: {
          orderBy: {
            createdAt: 'desc',
          },
        },
        payouts: {
          orderBy: {
            createdAt: 'desc',
          },
          take: 10,
        },
      },
    });

    if (!user) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }

    // Generate referral code if missing
    if (!user.referralCode) {
      const referralCode = `${user.email.split('@')[0]}_${Math.random()
        .toString(36)
        .substring(2, 8)}`.toUpperCase();
      await db.user.update({
        where: { id: user.id },
        data: { referralCode },
      });
      user.referralCode = referralCode;
    }

    // Compute affiliate stats
    const activeReferrals = user.referrals.filter(
      (r: any) =>
        r.subscription?.status === 'ACTIVE' && r.subscription?.tier !== 'FREE'
    );

    const totalReferrals = user.referrals.length;
    const nextPayoutDate = getNextFriday();

    return NextResponse.json({
      referralCode: user.referralCode,
      referralLink: `${process.env.NEXTAUTH_URL}/auth/signup?ref=${user.referralCode}`,
      totalReferrals,
      activeReferrals: activeReferrals.length,
      totalEarnings: user.totalEarnings,
      pendingEarnings: user.pendingEarnings,
      nextPayoutDate,
      hasPaymentInfo: !!(user.stripeAccountId || user.payoutEmail),
      payoutMethod: user.payoutMethod,
      referrals: user.referrals.map((r: any) => ({
        id: r.id,
        email: r.email,
        name: r.name,
        createdAt: r.createdAt,
        isActive:
          r.subscription?.status === 'ACTIVE' &&
          r.subscription?.tier !== 'FREE',
        tier: r.subscription?.tier,
      })),
      recentPayouts: user.payouts,
      recentEarnings: user.affiliateEarnings.slice(0, 5),
    });
  } catch (error: any) {
    console.error('Error fetching affiliate dashboard:', error);
    return NextResponse.json(
      { error: error.message ?? 'Internal Server Error' },
      { status: 500 }
    );
  }
}

function getNextFriday() {
  const today = new Date();
  const dayOfWeek = today.getDay(); // 0 = Sunday, 5 = Friday
  const daysUntilFriday = dayOfWeek <= 5 ? 5 - dayOfWeek : 6;
  const nextFriday = new Date(today);
  nextFriday.setDate(today.getDate() + daysUntilFriday);
  nextFriday.setHours(0, 0, 0, 0);
  return nextFriday;
}
