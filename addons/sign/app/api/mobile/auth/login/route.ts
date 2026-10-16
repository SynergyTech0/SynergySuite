import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import bcrypt from "bcryptjs";
import crypto from "crypto";

export async function POST(req: Request) {
  try {
    const { email, password } = await req.json();

    if (!email || !password) {
      return NextResponse.json(
        { error: "Missing email or password" },
        { status: 400 }
      );
    }

    // Find user with subscription and enterprise data
    const user = await prisma.user.findUnique({
      where: { email: email.toLowerCase() },
      include: {
        subscription: true,
        enterprise: true,
      }
    });

    if (!user) {
      return NextResponse.json(
        { error: "Invalid credentials" },
        { status: 401 }
      );
    }

    // Check if user has a password (not OAuth-only user)
    if (!user.password) {
      return NextResponse.json(
        { error: "This account uses social login. Please sign in through the web interface." },
        { status: 401 }
      );
    }

    // Verify password
    const valid = await bcrypt.compare(password, user.password);
    if (!valid) {
      // Log failed login attempt
      await prisma.accountAuditLog.create({
        data: {
          userId: user.id,
          event: "FAILED_LOG_IN",
        }
      });

      return NextResponse.json(
        { error: "Invalid credentials" },
        { status: 401 }
      );
    }

    // Check if email is verified (optional - remove if not required for mobile)
    // if (!user.emailVerified) {
    //   return NextResponse.json(
    //     { error: "Please verify your email before logging in" },
    //     { status: 403 }
    //   );
    // }

    // Generate session token for mobile
    const token = crypto.randomUUID();

    // Store mobile session in DB
    await prisma.session.create({
      data: {
        userId: user.id,
        sessionToken: token,
        expires: new Date(Date.now() + 1000 * 60 * 60 * 24 * 30) // 30 days
      }
    });

    // Log successful login
    await prisma.accountAuditLog.create({
      data: {
        userId: user.id,
        event: "LOGGED_IN",
      }
    });

    // Return user data with subscription info
    return NextResponse.json({
      success: true,
      token,
      user: {
        id: user.id,
        email: user.email,
        name: user.name || `${user.firstName || ''} ${user.lastName || ''}`.trim(),
        firstName: user.firstName,
        lastName: user.lastName,
        role: user.role,
        subscription: user.subscription ? {
          tier: user.subscription.tier,
          status: user.subscription.status,
          currentPeriodEnd: user.subscription.currentPeriodEnd,
        } : null,
        enterprise: user.enterprise ? {
          id: user.enterprise.id,
          name: user.enterprise.name,
        } : null,
      }
    });
  } catch (err) {
    console.error("Mobile login error:", err);
    return NextResponse.json(
      { error: "Server error" },
      { status: 500 }
    );
  }
}
