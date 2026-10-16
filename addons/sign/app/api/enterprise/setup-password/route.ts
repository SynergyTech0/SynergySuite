import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import bcrypt from "bcryptjs";
import { UserRole, SubscriptionTier, SubscriptionStatus, AccountEvent } from "@prisma/client";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { token, password } = body;

    if (!token || !password) {
      return NextResponse.json(
        { error: "Token and password are required" },
        { status: 400 }
      );
    }

    if (password.length < 8) {
      return NextResponse.json(
        { error: "Password must be at least 8 characters long" },
        { status: 400 }
      );
    }

    if (
      !/(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]/.test(
        password
      )
    ) {
      return NextResponse.json(
        {
          error:
            "Password must include uppercase, lowercase, number, and special character",
        },
        { status: 400 }
      );
    }

    const invitation = await prisma.enterpriseInvitation.findUnique({
      where: { token },
      include: {
        enterprise: true,
      },
    });

    if (!invitation) {
      return NextResponse.json(
        { error: "Invalid token" },
        { status: 400 }
      );
    }

    if (invitation.usedAt) {
      return NextResponse.json(
        { error: "This link has already been used" },
        { status: 400 }
      );
    }

    if (invitation.expiresAt < new Date()) {
      return NextResponse.json(
        { error: "This link has expired" },
        { status: 400 }
      );
    }

    const existingUser = await prisma.user.findUnique({
      where: { email: invitation.email },
    });

    if (existingUser) {
      return NextResponse.json(
        { error: "An account with this email already exists" },
        { status: 400 }
      );
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    const emailParts = invitation.email.split("@");
    const firstName = invitation.enterprise.contactName.split(" ")[0] || emailParts[0];
    const lastName = invitation.enterprise.contactName.split(" ").slice(1).join(" ") || emailParts[0];

    const referralCode = `${emailParts[0]
      .toUpperCase()}_${Math.random()
      .toString(36)
      .substring(2, 8)
      .toUpperCase()}`;

    const user = await prisma.user.create({
      data: {
        email: invitation.email,
        password: hashedPassword,
        firstName,
        lastName,
        role: UserRole.ADMIN,
        referralCode,
        enterpriseId: invitation.enterpriseId,
        emailVerified: new Date(),
      },
    });

    const enterpriseAccount = await prisma.enterpriseAccount.findUnique({
      where: { id: invitation.enterpriseId },
      select: { administratorId: true, subscriptionId: true },
    });

    if (enterpriseAccount?.administratorId && enterpriseAccount.administratorId !== user.id) {
      throw new Error("Enterprise account already has an administrator");
    }

    await prisma.enterpriseAccount.update({
      where: { id: invitation.enterpriseId },
      data: {
        administratorId: user.id,
        currentUserCount: { increment: 1 },
      },
    });

    const subscription = await prisma.subscription.create({
      data: {
        userId: user.id,
        tier: SubscriptionTier.ENTERPRISE,
        status: SubscriptionStatus.ACTIVE,
      },
    });

    await prisma.enterpriseAccount.update({
      where: { id: invitation.enterpriseId },
      data: {
        subscriptionId: subscription.id,
      },
    });

    await prisma.enterpriseInvitation.update({
      where: { id: invitation.id },
      data: {
        usedAt: new Date(),
        userId: user.id,
      },
    });

    await prisma.accountAuditLog.create({
      data: {
        userId: user.id,
        event: AccountEvent.REGISTERED,
      },
    });

    return NextResponse.json({
      success: true,
      message: "Password set successfully. You can now log in.",
    });
  } catch (error: any) {
    console.error("Password setup error:", error);
    return NextResponse.json(
      { 
        error: "Failed to set password. Please try again.",
        details: process.env.NODE_ENV === 'development' ? error?.message : undefined,
      },
      { status: 500 }
    );
  }
}

