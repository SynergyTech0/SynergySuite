import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { ENTERPRISE_PRICING } from "@/lib/stripe";

export async function GET(request: NextRequest) {
	try {
		const searchParams = request.nextUrl.searchParams;
		const token = searchParams.get("token");
		const requestId = searchParams.get("requestId");

		if (!token || !requestId) {
			return NextResponse.json(
				{ valid: false, message: "Token and request ID are required" },
				{ status: 400 }
			);
		}

		const enterpriseRequest = await prisma.enterpriseRequests.findUnique({
			where: { id: requestId },
		});

		if (!enterpriseRequest) {
			return NextResponse.json(
				{ valid: false, message: "Enterprise request not found" },
				{ status: 404 }
			);
		}

		// Check if token matches
		if (enterpriseRequest.paymentToken !== token) {
			return NextResponse.json(
				{ valid: false, message: "Invalid payment token" },
				{ status: 400 }
			);
		}

		// Check if token has expired
		if (
			enterpriseRequest.paymentTokenExpiresAt &&
			enterpriseRequest.paymentTokenExpiresAt < new Date()
		) {
			return NextResponse.json(
				{ valid: false, message: "Payment link has expired" },
				{ status: 400 }
			);
		}

		// Check if request is already activated
		if (enterpriseRequest.status === "ACTIVATED") {
			return NextResponse.json(
				{ valid: false, message: "This request has already been activated" },
				{ status: 400 }
			);
		}

		// Calculate yearly subscription cost based on team size
		// Extract numeric value from teamSize (e.g., "25-50" -> 25, "100+" -> 100)
		const teamSizeStr = String(enterpriseRequest.teamSize).replace(/[^0-9]/g, '');
		const seats = Math.max(parseInt(teamSizeStr, 10) || ENTERPRISE_PRICING.MIN_SEATS, ENTERPRISE_PRICING.MIN_SEATS);

		// Calculate yearly total: seats × $599.88/seat/year
		const yearlyTotal = seats * ENTERPRISE_PRICING.PRICE_PER_SEAT_PER_YEAR;

		// Return payment data
		return NextResponse.json({
			valid: true,
			requestId: enterpriseRequest.id,
			companyName: enterpriseRequest.companyName,
			contactName: enterpriseRequest.contactName,
			teamSize: enterpriseRequest.teamSize,
			seats: seats,
			amount: yearlyTotal,
			pricePerSeat: ENTERPRISE_PRICING.PRICE_PER_SEAT_PER_YEAR,
		});
	} catch (error) {
		console.error("Payment validation error:", error);
		return NextResponse.json(
			{ valid: false, message: "An error occurred while validating the payment link" },
			{ status: 500 }
		);
	}
}

