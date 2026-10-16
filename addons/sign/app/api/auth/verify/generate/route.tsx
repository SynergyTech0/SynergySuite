// Generate a 6-digit verification code and send it to the user's email
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { sendEmail } from "@/lib/email";
import { randomInt } from "crypto";
import { authOptions } from "@/lib/auth";
import { getServerSession } from "next-auth";
import bcrypt from "bcryptjs";

export async function POST(request: Request) {
	const session = await getServerSession(authOptions);

	if (!session || !session.user?.email) {
		return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
	}

	const email = session.user.email;

	if (!email) {
		return NextResponse.json(
			{ error: "Email is required" },
			{ status: 400 }
		);
	}

    const existingVerification = await prisma.verificationToken.findFirst({
        where: {
            userId: session.user.id,
            expires: { gt: new Date() },
            used: false,
        },
    });

    if (existingVerification) {
        if (request.headers.get("regenerate") === "true") {
            // Invalidate existing token
            await prisma.verificationToken.updateMany({
                where: {
                    userId: session.user.id,
                    expires: { gt: new Date() },
                    used: false,
                },
                data: {
                    expires: new Date(),
                },
            });

            await prisma.accountAuditLog.create({
                data: {
                    userId: session.user.id,
                    event: "TOKEN_DEACTIVATED",
                },
            });
        } else {
            return NextResponse.json(
                { error: "Verification code already sent" },
                { status: 400 }
            );
        }
	}

	// Generate a 6-digit verification code
    const unhashedCode = randomInt(100000, 999999).toString()
	const code = bcrypt.hashSync(unhashedCode + email, 12);

    if (!code) {
        return NextResponse.json(
            { error: "Failed to generate verification code" },
            { status: 500 }
        );
    }

	// Store the code in the database
	await prisma.verificationToken.create({
		data: {
			userId: session.user.id,
			token: code,
			expires: new Date(Date.now() + 15 * 60 * 1000), // Expires in 15 minutes
		},
	});

	// Send the verification email
	await sendEmail(
        email,
        "Your Verification Code",
        `<p>Your verification code is: <strong>${unhashedCode}</strong></p><p>This code will expire in 15 minutes.</p><p>If you didn't request this, please ignore this email.</p>`
    );

	return NextResponse.json({ message: "Verification code sent" });
}
