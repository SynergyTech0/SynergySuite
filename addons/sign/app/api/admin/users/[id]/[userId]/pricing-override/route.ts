import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/db";

export async function PUT(
  request: NextRequest,
  context: { params: Promise<{ id: string; userId: string }> }
) {
  try {
    // ✅ New signature: await context.params
    const { id, userId } = await context.params;
    const session = await getServerSession(authOptions);

    if (!session?.user || session.user.role !== "SYSTEM_ADMIN") {
      return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
    }

    const { pricingOverride } = await request.json();

    const user = await prisma.user.update({
      where: { id: userId },
      data: { pricingOverride: Boolean(pricingOverride) },
    });

    // (Optional) use `id` if you later want to log/update the enterprise
    return NextResponse.json(user);
  } catch (error: any) {
    console.error("Error updating pricing override:", error);
    return NextResponse.json(
      { message: error?.message || "Failed to update pricing override" },
      { status: 500 }
    );
  }
}
