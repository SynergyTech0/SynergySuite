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

    const user = await prisma.user.findUnique({
      where: { email: session.user.email },
    });

    if (!user) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    // Use weekStart for ordering since month field was removed
    const earnings = await prisma.affiliateEarning.findMany({
      where: { affiliateId: user.id },
      orderBy: { weekStart: "desc" },
    });

    // Get referred user details for each earning
    const earningsWithDetails = await Promise.all(
      earnings.map(async (earning) => {
        const referredUser = await prisma.user.findUnique({
          where: { id: earning.referredUserId },
        });

        return {
          id: earning.id,
          weekStart: earning.weekStart.toISOString(),
          weekEnd: earning.weekEnd.toISOString(),
          amount: earning.amount,
          isPaid: earning.isPaid,
          referredUserName:
            referredUser?.name || referredUser?.email || "Unknown",
          referredUserEmail: referredUser?.email || "Unknown",
        };
      })
    );

    return NextResponse.json(earningsWithDetails);
  } catch (error) {
    console.error("Error fetching earnings:", error);
    return NextResponse.json(
      { error: "Failed to fetch earnings" },
      { status: 500 }
    );
  }
}
