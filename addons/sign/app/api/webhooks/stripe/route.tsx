/**
 * Stripe Webhook Handler
 *
 * Processes Stripe webhook events to keep subscription status in sync
 * Critical for handling:
 * - checkout.session.completed - Initial subscription creation
 * - customer.subscription.updated - Plan changes, renewals
 * - customer.subscription.deleted - Cancellations
 * - invoice.payment_succeeded - Successful recurring payments
 * - invoice.payment_failed - Failed payments
 */
import { NextResponse } from "next/server";
import { headers } from "next/headers";
import { stripe, STRIPE_PRICING } from "@/lib/stripe";
import { prisma } from "@/lib/prisma";
import Stripe from "stripe";
import {
	NotificationType,
	SubscriptionStatus,
	SubscriptionTier,
} from "@prisma/client";
import { sendEmail } from "@/lib/email";
import { createNotification } from "@/lib/notifications";
import { generateInvitationToken } from "@/lib/invitation-tokens";
import { renderEnterprisePaymentConfirmation } from "@/lib/email-templates/enterprise-payment-confirmation";
import { publicBase } from "@/lib/urls";

// Disable body parsing, need raw body for webhook signature verification
export const runtime = "nodejs";

export async function POST(req: Request) {
	const body = await req.text();
	const signature = headers().get("stripe-signature");

	if (!signature) {
		console.error("❌ No signature in request headers");
		return NextResponse.json(
			{ error: "No signature provided" },
			{ status: 400 }
		);
	}

	let event: Stripe.Event;

	try {
		// Verify webhook signature
		event = stripe.webhooks.constructEvent(
			body,
			signature,
			process.env.STRIPE_WEBHOOK_SECRET!
		);
	} catch (err) {
		console.error("❌ Webhook signature verification failed:", err);
		return NextResponse.json(
			{ error: "Invalid signature" },
			{ status: 400 }
		);
	}

		try {
		// Handle different event types
		switch (event.type) {
			case "checkout.session.completed": {
				const session = event.data.object as Stripe.Checkout.Session;

				// Handle enterprise initial payment
				if (session.mode === "payment" && session.metadata?.type === "enterprise_initial_payment") {
					const requestId = session.metadata.requestId;
					
					if (!requestId) {
						console.error("❌ No request ID in enterprise payment session");
						break;
					}

					// Get the enterprise request
					const enterpriseRequest = await prisma.enterpriseRequests.findUnique({
						where: { id: requestId },
					});

					if (!enterpriseRequest) {
						console.error("❌ Enterprise request not found:", requestId);
						break;
					}

					// Check if already processed
					if (enterpriseRequest.status === "ACTIVATED") {
						console.log("✅ Enterprise request already activated:", requestId);
						break;
					}

					// Get or create enterprise account
					const emailDomain = enterpriseRequest.contactEmail.split("@")[1];
					let enterpriseAccount = await prisma.enterpriseAccount.findFirst({
						where: { domain: emailDomain },
					});

					if (!enterpriseAccount) {
						const teamSizeStr = enterpriseRequest.teamSize.toString();
						const userLimit = parseInt(teamSizeStr) || 25;

						enterpriseAccount = await prisma.enterpriseAccount.create({
							data: {
								name: enterpriseRequest.companyName,
								domain: emailDomain,
								contactEmail: enterpriseRequest.contactEmail,
								contactName: enterpriseRequest.contactName,
								userLimit: userLimit,
								isActive: true,
							},
						});
					}

					// Check if user exists
					const existingUser = await prisma.user.findUnique({
						where: { email: enterpriseRequest.contactEmail.toLowerCase() },
					});

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
						? `${publicBase()}/dashboard`
						: undefined;

					// Send confirmation email with password setup link
					try {
						const emailTemplate = renderEnterprisePaymentConfirmation({
							customerRequestId: enterpriseRequest.customerRequestId || "N/A",
							contactName: enterpriseRequest.contactName,
							companyName: enterpriseRequest.companyName,
							teamSizeRange: enterpriseRequest.teamSize,
							amount: 49.99,
							passwordSetupUrl,
						});

						await sendEmail(
							enterpriseRequest.contactEmail,
							"Payment Confirmed - Complete Your Enterprise Account Setup",
							emailTemplate
						);
					} catch (emailError) {
						console.error("❌ Failed to send confirmation email:", emailError);
					}

					// Update request status to ACTIVATED
					await prisma.enterpriseRequests.update({
						where: { id: requestId },
						data: {
							status: "ACTIVATED",
							updatedAt: new Date(),
						},
					});

					console.log("✅ Enterprise payment processed and account activated:", requestId);
					break;
				}

				// Handle setup mode (payment method update)
				if (session.mode === "setup") {
					const customerId =
						typeof session.customer === "string"
							? session.customer
							: session.customer?.id;

					if (!customerId) {
						console.error("❌ No customer ID in setup session");
						break;
					}

					// Find the user by Stripe customer ID
					const user = await prisma.user.findFirst({
						where: { stripeAccountId: customerId } as any,
						include: { subscription: true },
					}) as any;

					if (!user) {
						console.error(
							"❌ User not found for customer:",
							customerId
						);
						break;
					}

					// Get the setup intent to retrieve the payment method
					if (session.setup_intent) {
						const setupIntentId =
							typeof session.setup_intent === "string"
								? session.setup_intent
								: session.setup_intent.id;

						const setupIntent = await stripe.setupIntents.retrieve(
							setupIntentId
						);

						if (setupIntent.payment_method) {
							const paymentMethodId =
								typeof setupIntent.payment_method === "string"
									? setupIntent.payment_method
									: setupIntent.payment_method.id;

							// Set as default payment method for customer
							await stripe.customers.update(customerId, {
								invoice_settings: {
									default_payment_method: paymentMethodId,
								},
							});

							// Update all active subscriptions to use this payment method
							if (user.subscription?.stripeSubscriptionId) {
								await stripe.subscriptions.update(
									user.subscription.stripeSubscriptionId,
									{
										default_payment_method: paymentMethodId,
									}
								);
							}

							// Notify the user
							await sendEmail(
								user.email,
								"Payment Method Updated",
								`
								<p>Your payment method has been successfully updated on your SynergySign account.</p>
								<p>This payment method will be used for all future billing.</p>
								<p>If you did not make this change, please contact our support team immediately.</p>
								`
							);

							await createNotification(
								user.email,
								"Payment Method Updated",
								"Your payment method has been successfully updated.",
								NotificationType.OTHER,
								user.id
							);

							console.log(
								"✅ Payment method updated for user:",
								user.id
							);
						}
					}
				}
				break;
			}

			case "invoice.payment_succeeded": {
				const invoice = event.data.object as Stripe.Invoice; // Cast to any to access all invoice properties
				const invoiceData = invoice.lines.data[0];

				// Get the Stripe customer ID
				const customerId =
					typeof invoice.customer === "string"
						? invoice.customer
						: invoice.customer?.id;

				if (!customerId) {
					console.error("❌ No customer ID in invoice");
					break;
				}

				// Find the user by Stripe customer ID
				const user = await prisma.user.findFirst({
					where: { stripeAccountId: customerId } as any,
					include: { subscription: true },
				}) as any;

				if (!user) {
					console.error(
						"❌ User not found for customer:",
						customerId
					);
					break;
				}

				const productId = invoiceData.pricing?.price_details
					?.product as string;
				const priceId = invoiceData.pricing?.price_details
					?.price as string;
				const period = invoiceData.period;

				// Fetch full subscription details from Stripe
				const stripeProduct = await stripe.products.retrieve(productId);
				const stripePrice = await stripe.prices.retrieve(priceId);

				// Determine the tier based on the price ID by checking all pricing options
				let tier: "BASIC" | "PRO" = "BASIC";

				// Check against all pricing tiers and cycles
				for (const [tierName, cycles] of Object.entries(
					STRIPE_PRICING
				)) {
					if (Object.values(cycles).includes(stripePrice.id)) {
						tier = tierName as "BASIC" | "PRO";
						break;
					}
				}

				// Check if there's a pending tier change for downgrade
				const pendingTier = user.subscription?.pendingTier;
				if (pendingTier && user.subscription?.currentPeriodEnd) {
					const now = new Date();
					const periodEnd = new Date(user.subscription.currentPeriodEnd);

					// If we're at the end of the period, apply the pending tier
					if (now >= periodEnd) {
						tier = pendingTier as "BASIC" | "PRO";
						console.log(`✅ Applying pending tier change to ${tier} for user ${user.id}`);
					}
				}

				let latestActiveSubscription: Stripe.Subscription;
				// Keep only the most recently created active subscription; cancel older ones with proration
				try {
					const existingSubscriptions =
						await stripe.subscriptions.list({
							customer: customerId,
							status: "active",
							limit: 100,
						});

					if (existingSubscriptions.data.length > 0) {
						// Determine most recent by created timestamp
						latestActiveSubscription =
							existingSubscriptions.data[0];
						for (const sub of existingSubscriptions.data) {
							if (
								sub.created > latestActiveSubscription.created
							) {
								latestActiveSubscription = sub;
							}
						}

						for (const subscription of existingSubscriptions.data) {
							if (
								subscription.id === latestActiveSubscription.id
							) {
								continue;
							}

							await stripe.subscriptions.cancel(subscription.id, {
								prorate: true,
								invoice_now: true,
							});
						}

						// Reflect cancellations in DB
						await prisma.subscription.updateMany({
							where: {
								userId: user.id,
								status: "ACTIVE",
								NOT: {
									stripeSubscriptionId:
										latestActiveSubscription.id,
								},
							},
							data: {
								status: "CANCELLED",
								cancelAtPeriodEnd: true,
							},
						});

						// Update or create the subscription record
						const res = await prisma.subscription.upsert({
							where: { userId: user.id },
							update: {
								tier: tier as SubscriptionTier,
								status: "ACTIVE" as SubscriptionStatus,
								stripeSubscriptionId:
									latestActiveSubscription.id,
								stripePriceId: priceId,
								currentPeriodStart: new Date(
									period.start * 1000
								),
								currentPeriodEnd: new Date(period.end * 1000),
								pendingTier: null, // Clear pending tier after applying
							},
							create: {
								userId: user.id,
								tier: tier as SubscriptionTier,
								status: "ACTIVE" as SubscriptionStatus,
								stripeSubscriptionId:
									latestActiveSubscription.id,
								stripePriceId: priceId,
								currentPeriodStart: new Date(
									period.start * 1000
								),
								currentPeriodEnd: new Date(period.end * 1000),
							},
						});
					}
				} catch (error) {
					console.error("Error reconciling subscriptions:", error);
				}

				// Update the user's subscription status in the database
				await prisma.user.update({
					where: { id: user.id },
					data: {
						stripeAccountId: customerId,
					} as any,
				});

				// Notify the user via email and account notifications upon successful payment
				await sendEmail(
					user.email,
					"Subscription Successful to SynergySign",
					`
					<p>Thank you for subscribing to SynergySign! Your subscription is now active. You can start using your benefits right away. If you have any questions, feel free to reach out to our support team. We're excited to have you on board!</p>
					<h3>Your Subscription Details:</h3>
					<ul>
						<li><strong>Subscription Tier:</strong> ${tier}</li>
					</ul>
					<p>Thank you for choosing SynergySign!</p>
					<p>This is an automated email. If you have any questions, feel free to reach out to our support team.</p>
					`
				);
				await createNotification(
					user.email,
					"Subscription Successful",
					"Your subscription has been successfully processed.",
					NotificationType.OTHER,
					user.id
				);

				console.log(
					"✅ Subscription updated for user:",
					user.id + " to " + tier
				);
				break;
			}

			case "invoice.payment_failed": {
				const invoice = event.data.object as any; // Cast to any to access all invoice properties

				// Get the Stripe customer ID
				const customerId =
					typeof invoice.customer === "string"
						? invoice.customer
						: invoice.customer?.id;

				if (!customerId) {
					console.error("❌ No customer ID in failed invoice");
					break;
				}

				// Find the user by Stripe customer ID
				const user = await prisma.user.findFirst({
					where: { stripeAccountId: customerId } as any,
					include: { subscription: true },
				}) as any;

				if (!user) {
					console.error(
						"❌ User not found for customer:",
						customerId
					);
					break;
				}

				// Get the subscription ID from the invoice
				const subscriptionId =
					typeof invoice.subscription === "string"
						? invoice.subscription
						: invoice.subscription?.id;

				if (!subscriptionId) {
					console.error("❌ No subscription ID in failed invoice");
					break;
				}

				try {
					// Cancel the subscription on Stripe's side
					await stripe.subscriptions.cancel(subscriptionId);

					// Update the subscription status in the database
					await prisma.subscription.updateMany({
						where: {
							userId: user.id,
							stripeSubscriptionId: subscriptionId,
						},
						data: {
							status: "CANCELLED" as SubscriptionStatus,
							cancelAtPeriodEnd: false,
						},
					});

					// Notify the user via email
					await sendEmail(
						user.email,
						"Payment Failed - Subscription Cancelled",
						`
						<p>We were unable to process your recent payment for SynergySign.</p>
						<p>As a result, your subscription has been cancelled and you will no longer have access to premium features.</p>
						<p>If you would like to reactivate your subscription, please update your payment method and subscribe again from your dashboard.</p>
						<p>If you believe this is an error, please contact our support team immediately.</p>
						`
					);

					// Create an in-app notification
					await createNotification(
						user.email,
						"Payment Failed - Subscription Cancelled",
						"Your payment failed and your subscription has been cancelled. Please update your payment method to continue using premium features.",
						NotificationType.OTHER,
						user.id
					);

					console.log(
						"✅ Subscription cancelled due to payment failure for user:",
						user.id
					);
				} catch (error) {
					console.error(
						"❌ Error cancelling subscription after payment failure:",
						error
					);
				}
				break;
			}

			default:
				// console.warn(`Unhandled event type: ${event.type}`);
				break;
		}

		return NextResponse.json({ received: true });
	} catch (error) {
		console.error("Error processing webhook:", error);
		return NextResponse.json(
			{ error: "Webhook processing failed" },
			{ status: 500 }
		);
	}
}
