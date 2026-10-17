
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
          orderBy: {
            createdAt: "desc",
          },
        },
      },
    });

    if (!user) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    const referrals = user.referrals.map((ref) => ({
      id: ref.id,
      name: ref.name || ref.email,
      email: ref.email,
      joinedAt: ref.createdAt.toISOString(),
      subscriptionStatus: ref.subscription?.status || "INACTIVE",
      subscriptionTier: ref.subscription?.tier || "FREE",
      monthlyEarning:
        ref.subscription?.status === "ACTIVE" &&
        ref.subscription?.tier !== "FREE"
          ? 2
          : 0,
    }));

    return NextResponse.json(referrals);
  } catch (error) {
    console.error("Error fetching referrals:", error);
    return NextResponse.json(
      { error: "Failed to fetch referrals" },
      { status: 500 }
    );
  }
}
