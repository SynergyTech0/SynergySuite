import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export async function POST(req: Request) {
  try {
    const authHeader = req.headers.get("authorization");

    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return NextResponse.json(
        { error: "Missing or invalid authorization header" },
        { status: 401 }
      );
    }

    const token = authHeader.substring(7); // Remove "Bearer " prefix

    // Find and delete session
    const session = await prisma.session.findUnique({
      where: { sessionToken: token },
      include: { user: true }
    });

    if (session) {
      // Log logout event
      await prisma.accountAuditLog.create({
        data: {
          userId: session.userId,
          event: "LOGGED_OUT",
        }
      });

      // Delete session
      await prisma.session.delete({
        where: { sessionToken: token }
      });
    }

    return NextResponse.json({
      success: true,
      message: "Logged out successfully"
    });
  } catch (err) {
    console.error("Mobile logout error:", err);
    return NextResponse.json(
      { error: "Server error" },
      { status: 500 }
    );
  }
}
