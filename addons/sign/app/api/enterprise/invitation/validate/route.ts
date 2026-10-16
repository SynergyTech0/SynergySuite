import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export async function GET(request: NextRequest) {
	try {
		const searchParams = request.nextUrl.searchParams;
		const token = searchParams.get("token");

		if (!token) {
			return NextResponse.json(
				{ valid: false, message: "Invitation token is required" },
				{ status: 400 }
			);
		}

		// Find the invitation
		const invitation = await prisma.enterpriseInvitation.findUnique({
			where: { token },
			include: {
				enterprise: {
					select: {
						id: true,
						name: true,
					},
				},
			},
		});

		// Validate invitation
		if (!invitation) {
			return NextResponse.json({
				valid: false,
				message: "Invalid invitation token",
			});
		}

		if (invitation.usedAt) {
			return NextResponse.json({
				valid: false,
				message: "This invitation has already been used",
			});
		}

		if (invitation.expiresAt < new Date()) {
			return NextResponse.json({
				valid: false,
				message: "This invitation has expired",
			});
		}

		// Return valid invitation details
		return NextResponse.json({
			valid: true,
			email: invitation.email,
			enterpriseName: invitation.enterprise.name,
			expiresAt: invitation.expiresAt,
		});
	} catch (error) {
		console.error("Invitation validation error:", error);
		return NextResponse.json(
			{ valid: false, message: "An error occurred while validating the invitation" },
			{ status: 500 }
		);
	}
}
