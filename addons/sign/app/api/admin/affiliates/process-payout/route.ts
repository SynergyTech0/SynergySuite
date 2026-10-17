import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "@/lib/auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { PayoutStatus } from "@prisma/client";

export async function POST(request: NextRequest) {
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

    const body = await request.json();
    const { userId, amount, payoutMethod, transactionId, notes } = body;

    if (!userId || !amount) {
      return NextResponse.json(
        { error: "Missing required fields (userId, amount)" },
        { status: 400 }
      );
    }

    // Fetch unpaid earnings for this affiliate
    const unpaidEarnings = await prisma.affiliateEarning.findMany({
      where: {
        affiliateId: userId,
        isPaid: false,
      },
    });

    if (unpaidEarnings.length === 0) {
      return NextResponse.json(
        { message: "No unpaid earnings to process." },
        { status: 200 }
      );
    }

    // Calculate week range for the payout (covers current week)
    const now = new Date();
    const dayOfWeek = now.getUTCDay();
    const weekStart = new Date(now);
    weekStart.setUTCDate(now.getUTCDate() - dayOfWeek);
    weekStart.setUTCHours(0, 0, 0, 0);
    const weekEnd = new Date(weekStart);
    weekEnd.setUTCDate(weekStart.getUTCDate() + 7);

    // Create payout record
    const payout = await prisma.affiliatePayout.create({
      data: {
        userId,
        amount,
        status: PayoutStatus.COMPLETED,
        payoutMethod,
        transactionId,
        notes,
        processedAt: new Date(),
        weekStart,      // ✅ added
        weekEnd,        // ✅ added
      },
    });

    // Mark all unpaid earnings as paid and link to payout
    await prisma.affiliateEarning.updateMany({
      where: {
        affiliateId: userId,
        isPaid: false,
      },
      data: {
        isPaid: true,
        payoutId: payout.id,
      },
    });

    // Reset user's pending balance
    await prisma.user.update({
      where: { id: userId },
      data: { pendingEarnings: 0 },
    });

    return NextResponse.json({
      success: true,
      message: `Processed payout of $${amount.toFixed(2)} for user ${userId}`,
      payoutId: payout.id,
    });
  } catch (error) {
    console.error("Error processing payout:", error);
    return NextResponse.json(
      { error: "Failed to process payout" },
      { status: 500 }
    );
  }
}
