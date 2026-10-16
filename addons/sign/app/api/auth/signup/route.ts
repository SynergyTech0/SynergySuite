import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/db";
import { UserRole, SubscriptionTier, AccountEvent } from "@prisma/client";
import { sendEmail } from "@/lib/email";
import { randomInt } from "crypto";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const {
      email,
      password,
      firstName,
      lastName,
      companyName,
      role = "SENDER",
      referralCode,
      invitationToken,
    } = body;

    // Basic validation
    if (!email || !password || !firstName || !lastName) {
      return NextResponse.json(
        { error: "Missing required fields" },
        { status: 400 }
      );
    }

    if (firstName.match(/[^a-zA-Z'-]/) || lastName.match(/[^a-zA-Z'-]/)) {
      return NextResponse.json(
        { error: "Name contains invalid characters" },
        { status: 400 }
      );
    }

    if (!email.match(/^[^\s@]+@[^\s@]+\.[^\s@]+$/)) {
      return NextResponse.json(
        { error: "Please enter a valid email address" },
        { status: 400 }
      );
    }

    if (
      password.length < 8 ||
      !/(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]/.test(
        password
      )
    ) {
      return NextResponse.json(
        {
          error: "Password must be at least 8 characters and include uppercase, lowercase, number, and special character",
        },
        { status: 400 }
      );
    }

    // Check if user exists
    const existingUser = await prisma.user.findUnique({
      where: { email },
    });

    if (existingUser) {
      return NextResponse.json(
        { message: "User with this email already exists" },
        { status: 400 }
      );
    }

    // Check for invitation token
    let invitation = null;
    if (invitationToken) {
      invitation = await prisma.enterpriseInvitation.findUnique({
        where: { 
          token: invitationToken,
        },
        include: {
          enterprise: true,
        },
      });

      // Validate invitation
      // Enterprise invitation is now including invalid fields because why not
      if (!invitation) {
        return NextResponse.json(
          { message: "Invalid invitation token" },
          { status: 400 }
        );
      }

      if (invitation.usedAt) {
        return NextResponse.json(
          { message: "This invitation has already been used" },
          { status: 400 }
        );
      }

      if (invitation.expiresAt < new Date()) {
        return NextResponse.json(
          { message: "This invitation has expired" },
          { status: 400 }
        );
      }

      if (invitation.email.toLowerCase() !== email.toLowerCase()) {
        return NextResponse.json(
          { message: "This invitation was sent to a different email address" },
          { status: 400 }
        );
      }
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    // Enterprise domain check
    const emailDomain = email.split("@")[1];

    // Check if email domain matches any enterprise account (if no invitation)
    // Disabled for now, only allow via invitation because of issues with generic domains like gmail.com
    // Remove common public domains later if enabling
    let enterpriseAccount = null;
    // let enterpriseAccount = invitation?.enterprise || null;
    // if (!enterpriseAccount) {
    //   enterpriseAccount = await prisma.enterpriseAccount.findFirst({
    //     where: { domain: emailDomain, isActive: true },
    //   });
    // }

    // Referral_code check
    let referrerId: string | null = null;

    if (referralCode) {
      const referrer = await prisma.user.findUnique({
        where: { referralCode },
      });
      if (referrer) referrerId = referrer.id;
    }

    // Generate new referral code
    const newReferralCode = `${email
      .split("@")[0]
      .toUpperCase()}_${Math.random()
      .toString(36)
      .substring(2, 8)
      .toUpperCase()}`;

    // Create user + subscription
    const user = await prisma.user.create({
      data: {
        email,
        password: hashedPassword,
        firstName,
        lastName,
        name: `${firstName} ${lastName}`,
        companyName,
        role: role as UserRole,
        enterpriseId: enterpriseAccount?.id ?? null,
        referredById: referrerId,
        referralCode: newReferralCode,
      },
      include: {
        enterprise: true,
      },
    });

    // Remove sensitive data
    const { password: _pw, ...userSafe } = user;

    // Audit log
    await prisma.accountAuditLog.create({
      data: {
        userId: user.id,
        event: AccountEvent.REGISTERED,
      },
    });

    // Update enterprise user count if applicable
    if (enterpriseAccount) {
      await prisma.enterpriseAccount.update({
        where: { id: enterpriseAccount.id },
        data: { currentUserCount: { increment: 1 } },
      });

      await prisma.enterpriseInvitation.updateMany({
        where: {
          email,
          enterpriseId: enterpriseAccount.id,
        },
        data: {
          usedAt: new Date(),
          userId: user.id,
        },
      });

      await prisma.user.update({
        where: { id: user.id },
        data: {
          companyName: enterpriseAccount.name,
        }
      });

      // Not making individual subscription for enterprise users, should be covered if they are removed later
    } else {
      await prisma.subscription.create({
        data: {
          userId: user.id,
          tier: 'FREE',
          status: 'TRIAL',
          trialEndsAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)
        }
      });
    }

    // Automatically send verification email
    try {
      // Generate a 6-digit verification code
      const unhashedCode = randomInt(100000, 999999).toString();
      const hashedCode = await bcrypt.hash(unhashedCode + email, 12);

      // Store the verification token in database
      await prisma.verificationToken.create({
        data: {
          userId: user.id,
          token: hashedCode,
          expires: new Date(Date.now() + 15 * 60 * 1000), // Expires in 15 minutes
        },
      });

      // Send verification email
      await sendEmail(
        email,
        "Your SynergySign Verification Code",
        `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
            <h2 style="color: #2563eb;">Welcome to SynergySign!</h2>
            <p>Thank you for signing up. To complete your registration and start using SynergySign, please verify your email address.</p>
            <div style="background-color: #f3f4f6; padding: 20px; border-radius: 8px; text-align: center; margin: 20px 0;">
              <p style="font-size: 14px; color: #6b7280; margin-bottom: 10px;">Your verification code is:</p>
              <p style="font-size: 32px; font-weight: bold; color: #2563eb; letter-spacing: 4px; margin: 10px 0;">${unhashedCode}</p>
            </div>
            <p>This code will expire in <strong>15 minutes</strong>.</p>
            <p style="color: #6b7280; font-size: 14px;">If you didn't create an account with SynergySign, please ignore this email.</p>
            <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 20px 0;">
            <p style="color: #9ca3af; font-size: 12px;">
              This is an automated message from SynergySign. Please do not reply to this email.
            </p>
          </div>
        `
      );

      console.log(`Verification email sent to ${email}`);
    } catch (emailError) {
      console.error("Failed to send verification email:", emailError);
      // Don't fail signup if email fails - user can request resend
    }

    return NextResponse.json(
      {
        message: "User created successfully",
        user: userSafe,
      },
      { status: 201 }
    );
  } catch (error) {
    console.error("Signup error:", error);
    const errorMessage = error instanceof Error ? error.message : "Internal server error";
    const errorStack = error instanceof Error ? error.stack : undefined;
    console.error("Error details:", { message: errorMessage, stack: errorStack });
    return NextResponse.json(
      { error: errorMessage, details: process.env.NODE_ENV === 'development' ? errorStack : undefined },
      { status: 500 }
    );
  }
}
