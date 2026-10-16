// Verify a user's email using a 6-digit verification code

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { authOptions } from "@/lib/auth";
import { getServerSession } from "next-auth";
import bcrypt from "bcryptjs";

const FAILED_ATTEMPTS_LIMIT = 5;

export async function POST(request: Request) {
    const session = await getServerSession(authOptions);
    if (!session || !session.user?.email) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json();
    const { code } = body;

    if (!code || !/^\d{6}$/.test(code)) {
        return NextResponse.json(
            { error: "Invalid verification code format" },
            { status: 400 }
        );
    }

    const verificationRecord = await prisma.verificationToken.findFirst({
        where: {
            userId: session.user.id,
            expires: { gt: new Date() },
            used: false,
        },
    });

    if (!verificationRecord) {
        return NextResponse.json(
            { error: "No valid verification code found. Please request a new one." },
            { status: 400 }
        );
    }

    const isCodeValid = await bcrypt.compare(code + session.user.email, verificationRecord.token);

    if (!isCodeValid) {
        const attempts = (verificationRecord?.attempts || 0) + 1;
        await prisma.verificationToken.update({
            where: { id: verificationRecord.id },
            data: { attempts },
        });

        await prisma.accountAuditLog.create({
            data: {
                userId: session.user.id,
                event: "FAILED_VERIFICATION",
            },
        });

        if (attempts >= FAILED_ATTEMPTS_LIMIT) {
            await prisma.verificationToken.update({
                where: { id: verificationRecord.id },
                data: { expires: new Date() },
            });

            await prisma.accountAuditLog.create({
                data: {
                    userId: session.user.id,
                    event: "TOKEN_DEACTIVATED",
                },
            });

            return NextResponse.json(
                { error: "Too many failed attempts. Verification code has expired." },
                { status: 400 }
            );
        }

        return NextResponse.json(
            { error: "Invalid verification code. Please try again." },
            { status: 400 }
        );
    }

    // Mark the verification code as used
    await prisma.verificationToken.update({
        where: { id: verificationRecord.id },
        data: { used: true },
    });

    // Update user's emailVerified field
    await prisma.user.update({
        where: { id: session.user.id },
        data: { emailVerified: new Date() },
    });

    await prisma.accountAuditLog.create({
        data: {
            userId: session.user.id,
            event: "VERIFIED",
        },
    });
    
    return NextResponse.json({ message: "Email verified successfully" });
}