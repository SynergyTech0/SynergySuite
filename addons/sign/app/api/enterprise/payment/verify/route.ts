import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { stripe, ENTERPRISE_PRICING } from "@/lib/stripe";
import { generateInvitationToken } from "@/lib/invitation-tokens";
import { sendEmail } from "@/lib/email";
import { renderEnterprisePaymentConfirmation } from "@/lib/email-templates/enterprise-payment-confirmation";

export async function POST(request: NextRequest) {
	try {
		const { sessionId, requestId } = await request.json();

		if (!sessionId || !requestId) {
			return NextResponse.json(
				{ error: "Session ID and request ID are required" },
				{ status: 400 }
			);
		}

		// Retrieve the checkout session from Stripe
		const session = await stripe.checkout.sessions.retrieve(sessionId, {
			expand: ['subscription'],
		});

		if (!session) {
			return NextResponse.json(
				{ error: "Invalid payment session" },
				{ status: 400 }
			);
		}

		// For subscription mode, check subscription status
		// For initial payment, the subscription starts immediately
		if (session.mode === 'subscription') {
			if (!session.subscription) {
				return NextResponse.json(
					{ error: "Subscription not found" },
					{ status: 400 }
				);
			}
			// Get subscription status
			const subscriptionId = typeof session.subscription === 'string'
				? session.subscription
				: session.subscription.id;

			const subscription = await stripe.subscriptions.retrieve(subscriptionId);

			if (!subscription || (subscription.status !== 'active' && subscription.status !== 'trialing')) {
				return NextResponse.json(
					{ error: "Subscription not active" },
					{ status: 400 }
				);
			}
		} else {
			// Fallback for one-time payment mode
			if (session.payment_status !== "paid") {
				return NextResponse.json(
					{ error: "Payment not completed" },
					{ status: 400 }
				);
			}
		}

		// Get the enterprise request
		const enterpriseRequest = await prisma.enterpriseRequests.findUnique({
			where: { id: requestId },
		});

		if (!enterpriseRequest) {
			return NextResponse.json(
				{ error: "Enterprise request not found" },
				{ status: 404 }
			);
		}

		// Check if already processed
		if (enterpriseRequest.status === "ACTIVATED") {
			return NextResponse.json({ success: true, message: "Already processed" });
		}

		// Calculate seats and yearly amount
		const teamSizeStr = String(enterpriseRequest.teamSize).replace(/[^0-9]/g, '');
		const seats = Math.max(parseInt(teamSizeStr, 10) || ENTERPRISE_PRICING.MIN_SEATS, ENTERPRISE_PRICING.MIN_SEATS);
		const yearlyAmount = seats * ENTERPRISE_PRICING.PRICE_PER_SEAT_PER_YEAR;

		// Get subscription ID
		const subscriptionId = typeof session.subscription === 'string'
			? session.subscription
			: session.subscription?.id;

		// Get or create enterprise account
		const emailDomain = enterpriseRequest.contactEmail.split("@")[1];
		let enterpriseAccount = await prisma.enterpriseAccount.findFirst({
			where: { domain: emailDomain },
		});

		if (!enterpriseAccount) {
			enterpriseAccount = await prisma.enterpriseAccount.create({
				data: {
					name: enterpriseRequest.companyName,
					domain: emailDomain,
					contactEmail: enterpriseRequest.contactEmail,
					contactName: enterpriseRequest.contactName,
					userLimit: seats,
					isActive: true,
					contractStartDate: new Date(),
					contractEndDate: new Date(new Date().setFullYear(new Date().getFullYear() + 1)),
				},
			});
		}

		// Check if user exists
		const existingUser = await prisma.user.findUnique({
			where: { email: enterpriseRequest.contactEmail.toLowerCase() },
		});

		// Create or update subscription record
		if (existingUser && subscriptionId) {
			await prisma.subscription.upsert({
				where: { userId: existingUser.id },
				create: {
					userId: existingUser.id,
					tier: 'ENTERPRISE',
					status: 'ACTIVE',
					stripeSubscriptionId: subscriptionId,
					currentPeriodStart: new Date(),
					currentPeriodEnd: new Date(new Date().setFullYear(new Date().getFullYear() + 1)),
				},
				update: {
					tier: 'ENTERPRISE',
					status: 'ACTIVE',
					stripeSubscriptionId: subscriptionId,
					currentPeriodStart: new Date(),
					currentPeriodEnd: new Date(new Date().setFullYear(new Date().getFullYear() + 1)),
				}
			});

			// Link user to enterprise
			await prisma.user.update({
				where: { id: existingUser.id },
				data: {
					enterpriseId: enterpriseAccount.id,
				},
			});

			// Update enterprise with admin
			const subscription = await prisma.subscription.findUnique({
				where: { userId: existingUser.id },
			});

			if (subscription) {
				await prisma.enterpriseAccount.update({
					where: { id: enterpriseAccount.id },
					data: {
						subscriptionId: subscription.id,
						administratorId: existingUser.id,
						currentUserCount: 1,
					},
				});
			}
		}

		// Generate password setup token if user doesn't exist
		let passwordSetupToken: string | undefined;
		const expiresAt = new Date();
		expiresAt.setDate(expiresAt.getDate() + 7);

		if (!existingUser) {
			const existingInvitation = await prisma.enterpriseInvitation.findFirst({
				where: {
					email: enterpriseRequest.contactEmail.toLowerCase(),
					enterpriseId: enterpriseAccount.id,
				},
				orderBy: {
					createdAt: "desc",
				},
			});

			if (existingInvitation) {
				passwordSetupToken = generateInvitationToken();
				await prisma.enterpriseInvitation.update({
					where: { id: existingInvitation.id },
					data: {
						token: passwordSetupToken,
						expiresAt,
						usedAt: null,
						userId: null,
					},
				});
			} else {
				passwordSetupToken = generateInvitationToken();
				await prisma.enterpriseInvitation.create({
					data: {
						token: passwordSetupToken,
						email: enterpriseRequest.contactEmail.toLowerCase(),
						enterpriseId: enterpriseAccount.id,
						expiresAt,
						invitedBy: enterpriseRequest.submitter,
					},
				});
			}
		}

		const passwordSetupUrl = passwordSetupToken
			? `${process.env.NEXTAUTH_URL || "http://localhost:3000"}/enterprise/setup-password?token=${passwordSetupToken}`
			: undefined;

		// Send confirmation email with password setup link
		try {
			const emailTemplate = renderEnterprisePaymentConfirmation({
				customerRequestId: enterpriseRequest.customerRequestId || "N/A",
				contactName: enterpriseRequest.contactName,
				companyName: enterpriseRequest.companyName,
				teamSizeRange: enterpriseRequest.teamSize,
				amount: yearlyAmount,
				seats: seats,
				pricePerSeat: ENTERPRISE_PRICING.PRICE_PER_SEAT_PER_YEAR,
				passwordSetupUrl,
			});

			await sendEmail(
				enterpriseRequest.contactEmail,
				"Payment Confirmed - Complete Your Enterprise Account Setup",
				emailTemplate
			);
		} catch (emailError) {
			console.error("Failed to send confirmation email:", emailError);
			// Don't fail the request if email fails
		}

		// Update request status to ACTIVATED
		await prisma.enterpriseRequests.update({
			where: { id: requestId },
			data: {
				status: "ACTIVATED",
				updatedAt: new Date(),
			},
		});

		return NextResponse.json({
			success: true,
			message: "Payment verified and account activated",
		});
	} catch (error: any) {
		console.error("Payment verification error:", error);
		return NextResponse.json(
			{ error: error.message || "Failed to verify payment" },
			{ status: 500 }
		);
	}
}

