import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { stripe, STRIPE_PRICING, ENTERPRISE_PRICING } from "@/lib/stripe";

export async function POST(request: NextRequest) {
	try {
		const { token, requestId } = await request.json();

		if (!token || !requestId) {
			return NextResponse.json(
				{ error: "Token and request ID are required" },
				{ status: 400 }
			);
		}

		// Validate the payment token
		const enterpriseRequest = await prisma.enterpriseRequests.findUnique({
			where: { id: requestId },
		});

		if (!enterpriseRequest) {
			return NextResponse.json(
				{ error: "Enterprise request not found" },
				{ status: 404 }
			);
		}

		if (enterpriseRequest.paymentToken !== token) {
			return NextResponse.json(
				{ error: "Invalid payment token" },
				{ status: 400 }
			);
		}

		if (
			enterpriseRequest.paymentTokenExpiresAt &&
			enterpriseRequest.paymentTokenExpiresAt < new Date()
		) {
			return NextResponse.json(
				{ error: "Payment link has expired" },
				{ status: 400 }
			);
		}

		// Get or create Stripe customer
		let stripeCustomerId = enterpriseRequest.stripeCustomerId;

		if (!stripeCustomerId) {
			// Create Stripe customer
			const customer = await stripe.customers.create({
				email: enterpriseRequest.contactEmail,
				name: enterpriseRequest.contactName,
				metadata: {
					requestId: enterpriseRequest.id,
					companyName: enterpriseRequest.companyName,
				},
			});

			stripeCustomerId = customer.id;

			// Update request with Stripe customer ID
			await prisma.enterpriseRequests.update({
				where: { id: requestId },
				data: { stripeCustomerId },
			});
		}

		// Calculate number of seats from team size
		const teamSizeStr = String(enterpriseRequest.teamSize).replace(/[^0-9]/g, '');
		const seats = Math.max(parseInt(teamSizeStr, 10) || ENTERPRISE_PRICING.MIN_SEATS, ENTERPRISE_PRICING.MIN_SEATS);

		// Get Enterprise annual price ID from environment
		const enterprisePriceId = STRIPE_PRICING.ENTERPRISE.annual;

		if (!enterprisePriceId) {
			throw new Error("Enterprise annual price ID not configured. Please set STRIPE_ENTERPRISE_ANNUAL_PRICE_ID in environment variables.");
		}

		// Create Stripe Checkout Session for yearly subscription
		const baseUrl = process.env.NEXTAUTH_URL || "http://localhost:3000";
		const successUrl = `${baseUrl}/enterprise/payment/success?session_id={CHECKOUT_SESSION_ID}&requestId=${requestId}`;
		const cancelUrl = `${baseUrl}/enterprise/payment?token=${token}&requestId=${requestId}`;

		const session = await stripe.checkout.sessions.create({
			customer: stripeCustomerId,
			payment_method_types: ["card"],
			line_items: [
				{
					price: enterprisePriceId,
					quantity: seats,
				},
			],
			mode: "subscription",
			success_url: successUrl,
			cancel_url: cancelUrl,
			metadata: {
				requestId: requestId,
				type: "enterprise_subscription",
				companyName: enterpriseRequest.companyName,
				seats: seats.toString(),
			},
			subscription_data: {
				metadata: {
					requestId: requestId,
					companyName: enterpriseRequest.companyName,
					seats: seats.toString(),
				},
			},
			// Stripe requires expires_at to be less than 24 hours from creation
			// Set to 23 hours to be safe
			expires_at: Math.floor(Date.now() / 1000) + (23 * 60 * 60),
		});

		return NextResponse.json({
			checkoutUrl: session.url,
			sessionId: session.id,
		});
	} catch (error: any) {
		console.error("Checkout creation error:", error);
		return NextResponse.json(
			{ error: error.message || "Failed to create checkout session" },
			{ status: 500 }
		);
	}
}

