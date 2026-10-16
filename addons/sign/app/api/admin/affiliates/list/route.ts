import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma as db } from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  try {
    const session = await getServerSession(authOptions);

    if (!session?.user?.email) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const user = await db.user.findUnique({
      where: { email: session.user.email }
    });

    if (user?.role !== 'ADMIN') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const affiliates = await db.user.findMany({
      where: {
        referralCode: {
          not: undefined // ✅ fixed: 'null' not allowed in Prisma filter
        }
      },
      include: {
        _count: {
          select: {
            referrals: true,
            payouts: true // ✅ removed 'earnings' (not a countable relation)
          }
        },
        referrals: {
          where: {
            subscription: {
              status: 'ACTIVE',
              tier: {
                not: 'FREE'
              }
            }
          }
        }
      },
      orderBy: {
        totalEarnings: 'desc'
      }
    });

    return NextResponse.json({
      affiliates: affiliates.map((a: any) => ({
        id: a.id,
        email: a.email,
        name: a.name,
        referralCode: a.referralCode,
        totalEarnings: a.totalEarnings,
        totalReferrals: a._count.referrals,
        activeReferrals: a.referrals.length,
        totalPayouts: a._count.payouts,
        hasPaymentInfo: !!(a.stripeAccountId || a.payoutEmail),
        payoutMethod: a.payoutMethod,
        createdAt: a.createdAt
      }))
    });

  } catch (error: any) {
    console.error('Error fetching affiliates:', error);
    return NextResponse.json(
      { error: error.message },
      { status: 500 }
    );
  }
}
