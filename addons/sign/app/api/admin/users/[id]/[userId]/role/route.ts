import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "@/lib/auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/db";

export async function PUT(
  request: NextRequest,
  context: { params: Promise<{ id: string; userId: string }> }
) {
  try {
    // ✅ New: must await the async params object
    const { id, userId } = await context.params;
    const session = await getServerSession(authOptions);

    if (!session?.user || session.user.role !== "SYSTEM_ADMIN") {
      return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
    }

    const { role } = await request.json();

    const user = await prisma.user.update({
      where: { id: userId },
      data: { role },
    });

    // Optionally use `id` if this route ties into enterprise or tenant scoping
    return NextResponse.json(user);
  } catch (error: any) {
    console.error("Error updating user role:", error);
    return NextResponse.json(
      { message: error?.message || "Failed to update role" },
      { status: 500 }
    );
  }
}
