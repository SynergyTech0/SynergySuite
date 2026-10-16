
import { NextResponse } from "next/server";
import { getServerSession } from "@/lib/auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/db";

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const session = await getServerSession(authOptions);
    
    if (!session?.user?.email) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const user = await prisma.user.findUnique({
      where: { email: session.user.email },
      include: {
        referrals: {
          include: {
            subscription: true,
          },
        },
        affiliateEarnings: true,
      },
    });

    if (!user) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    // Calculate stats
    const totalReferrals = user.referrals.length;
    const activeReferrals = user.referrals.filter(
      (ref) =>
        ref.subscription?.status === "ACTIVE" &&
        ref.subscription?.tier !== "FREE"
    ).length;

    const totalEarnings = user.totalEarnings;
    const pendingEarnings = user.pendingEarnings;

    // Calculate expected monthly earnings ($2 per active referral)
    const monthlyEarnings = activeReferrals * 2;

    return NextResponse.json({
      totalReferrals,
      activeReferrals,
      totalEarnings,
      pendingEarnings,
      monthlyEarnings,
    });
  } catch (error) {
    console.error("Error fetching affiliate stats:", error);
    return NextResponse.json(
      { error: "Failed to fetch stats" },
      { status: 500 }
    );
  }
}
