import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { sendEmail } from "@/lib/email";
import { renderEnterpriseRequestApproved } from "@/lib/email-templates";
import crypto from "crypto";
import { publicBase } from "@/lib/urls";

export async function POST(request: NextRequest) {
	try {
		const { requestId } = await request.json();

		if (!requestId) {
			return NextResponse.json(
				{ error: "Request ID is required" },
				{ status: 400 }
			);
		}

		const enterpriseRequest = await prisma.enterpriseRequests.findUnique({
			where: { id: requestId },
		});

		if (!enterpriseRequest) {
			return NextResponse.json(
				{ error: "Enterprise request not found" },
				{ status: 404 }
			);
		}

		// Check if request is already activated
		if (enterpriseRequest.status === "ACTIVATED") {
			return NextResponse.json(
				{ error: "This request has already been activated" },
				{ status: 400 }
			);
		}

		// Only allow regeneration if status is APPROVED
		if (enterpriseRequest.status !== "APPROVED") {
			return NextResponse.json(
				{ error: "Payment link can only be regenerated for approved requests" },
				{ status: 400 }
			);
		}

		// Generate new payment token
		const paymentToken = crypto.randomBytes(32).toString('hex');
		const paymentTokenExpiresAt = new Date();
		paymentTokenExpiresAt.setDate(paymentTokenExpiresAt.getDate() + 7); // 7 days expiry

		// Update request with new payment token
		await prisma.enterpriseRequests.update({
			where: { id: requestId },
			data: {
				paymentToken,
				paymentTokenExpiresAt,
			},
		});

		// Create new payment link URL
		const paymentUrl = `${publicBase()}/enterprise/payment?token=${paymentToken}&requestId=${requestId}`;

		// Send email with new payment link
		const emailTemplate = renderEnterpriseRequestApproved({
			customerRequestId: enterpriseRequest.customerRequestId || "N/A",
			contactName: enterpriseRequest.contactName,
			companyName: enterpriseRequest.companyName,
			teamSizeRange: enterpriseRequest.teamSize,
			message: enterpriseRequest.message || undefined,
			paymentUrl,
		});

		await sendEmail(
			enterpriseRequest.contactEmail,
			"New Payment Link - Complete Your Enterprise Plan Payment",
			emailTemplate
		);

		return NextResponse.json({
			success: true,
			message: "New payment link has been sent to your email",
		});
	} catch (error: any) {
		console.error("Error regenerating payment link:", error);
		return NextResponse.json(
			{ error: error.message || "Failed to regenerate payment link" },
			{ status: 500 }
		);
	}
}

