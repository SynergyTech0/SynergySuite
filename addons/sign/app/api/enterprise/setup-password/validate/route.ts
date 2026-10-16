import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const token = searchParams.get("token");

    if (!token) {
      return NextResponse.json(
        { valid: false, message: "Token is required" },
        { status: 400 }
      );
    }

    const invitation = await prisma.enterpriseInvitation.findUnique({
      where: { token },
      include: {
        enterprise: {
          select: {
            id: true,
            name: true,
            contactEmail: true,
          },
        },
      },
    });

    if (!invitation) {
      return NextResponse.json({
        valid: false,
        message: "Invalid token",
      });
    }

    if (invitation.usedAt) {
      return NextResponse.json({
        valid: false,
        message: "This link has already been used",
      });
    }

    if (invitation.expiresAt < new Date()) {
      return NextResponse.json({
        valid: false,
        message: "This link has expired",
      });
    }

    const existingUser = await prisma.user.findUnique({
      where: { email: invitation.email },
    });

    if (existingUser) {
      return NextResponse.json({
        valid: false,
        message: "An account with this email already exists. Please log in instead.",
      });
    }

    return NextResponse.json({
      valid: true,
      email: invitation.email,
      enterpriseName: invitation.enterprise.name,
      expiresAt: invitation.expiresAt,
    });
  } catch (error) {
    console.error("Token validation error:", error);
    return NextResponse.json(
      { valid: false, message: "An error occurred while validating the token" },
      { status: 500 }
    );
  }
}

