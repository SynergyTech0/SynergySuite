import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/db";

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const session = await getServerSession(authOptions);

    if (!session?.user?.email) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const currentUser = await prisma.user.findUnique({
      where: { email: session.user.email },
    });

    if (currentUser?.role !== "SYSTEM_ADMIN") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    // Fetch users with their referrals
    const users = await prisma.user.findMany({
      include: {
        referrals: {
          include: {
            subscription: true,
          },
        },
      },
    });

    type AffiliateUser = {
      id: string;
      name: string | null;
      email: string | null;
      totalEarnings: number;
      pendingEarnings: number;
      referrals: {
        subscription: {
          status: string;
          tier: string;
        } | null;
      }[];
    };

    type AffiliateOverview = {
      id: string;
      name: string | null;
      email: string | null;
      totalEarnings: number;
      pendingEarnings: number;
      totalReferrals: number;
      activeReferrals: number;
    };

    const affiliates: AffiliateOverview[] = users.map((user: AffiliateUser) => {
      const totalReferrals = user.referrals.length;
      const activeReferrals = user.referrals.filter(
        (ref) =>
          ref.subscription?.status === "ACTIVE" &&
          ref.subscription?.tier !== "FREE"
      ).length;

      return {
        id: user.id,
        name: user.name || user.email,
        email: user.email,
        totalEarnings: user.totalEarnings,
        pendingEarnings: user.pendingEarnings,
        totalReferrals,
        activeReferrals,
      };
    });

    // ✅ Use explicit type alias instead of inline typeof
    const pendingPayouts = affiliates
      .filter((a: AffiliateOverview) => a.pendingEarnings > 0)
      .map((a: AffiliateOverview) => ({
        userId: a.id,
        userName: a.name,
        userEmail: a.email,
        amount: a.pendingEarnings,
      }));

    return NextResponse.json({
      affiliates,
      pendingPayouts,
    });
  } catch (error) {
    console.error("Error fetching affiliate overview:", error);
    return NextResponse.json(
      { error: "Failed to fetch data" },
      { status: 500 }
    );
  }
}
