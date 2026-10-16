import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/db";

export async function DELETE(
  request: NextRequest,
  context: { params: Promise<{ id: string; userId: string }> }
) {
  try {
    const { id, userId } = await context.params;
    const session = await getServerSession(authOptions);

    if (!session?.user || session.user.role !== "SYSTEM_ADMIN") {
      return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
    }

    // Fetch enterprise to adjust user count
    const enterprise = await prisma.enterpriseAccount.findUnique({
      where: { id },
    });

    if (!enterprise) {
      return NextResponse.json({ message: "Enterprise not found" }, { status: 404 });
    }

    // Remove user from enterprise and reset privileges
    await prisma.user.update({
      where: { id: userId },
      data: {
        enterpriseId: null,
        role: "SENDER",
        pricingOverride: false,
      },
    });

    // Safely decrement user count (no negatives)
    await prisma.enterpriseAccount.update({
      where: { id },
      data: {
        currentUserCount: Math.max(0, (enterprise.currentUserCount ?? 1) - 1),
      },
    });

    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error("Error removing user from enterprise:", error);
    return NextResponse.json(
      { message: error?.message || "Failed to remove user" },
      { status: 500 }
    );
  }
}
