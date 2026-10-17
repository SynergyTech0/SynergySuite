import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "@/lib/auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { NotificationType } from "@prisma/client";
import { createNotification } from "@/lib/notifications";
import { sendEmail } from "@/lib/email";
import {
	renderEnterpriseRequestConfirmation,
	renderEnterpriseRequestAdminNotification,
} from "@/lib/email-templates";
import { stripe } from "@/lib/stripe";

const ERROR_MESSAGE =
	"Enterprise licensing is only available for teams with 25 or more users.";
const MIN_REQUIRED_TEAM_SIZE = 25;

type ValidationResult = { valid: boolean; error?: string };

async function generateUniqueCustomerRequestId(): Promise<string> {
	let customerRequestId: string;
	let isUnique = false;
	let attempts = 0;
	const maxAttempts = 10;

	while (!isUnique && attempts < maxAttempts) {
		customerRequestId = Math.floor(
			100000 + Math.random() * 900000
		).toString();

		const existing = await prisma.enterpriseRequests.findUnique({
			where: { customerRequestId },
		});

		if (!existing) {
			isUnique = true;
		} else {
			attempts++;
		}
	}

	if (!isUnique) {
		throw new Error(
			"Failed to generate unique CustomerRequestId after multiple attempts"
		);
	}

	return customerRequestId!;
}

function validateTeamSize(teamSizeRange: unknown): ValidationResult {
	if (
		teamSizeRange === null ||
		teamSizeRange === undefined ||
		teamSizeRange === ""
	) {
		return { valid: false, error: "Team size is required" };
	}

	const teamSizeStr = String(teamSizeRange).replace(/[^0-9]/g, '');
	const teamSizeNum = parseInt(teamSizeStr, 10);

	if (isNaN(teamSizeNum) || teamSizeNum < MIN_REQUIRED_TEAM_SIZE) {
		return { valid: false, error: ERROR_MESSAGE };
	}

	return { valid: true };
}

export async function POST(request: NextRequest) {
	try {
		const session = await getServerSession(authOptions);
		const { companyName, contactName, email, teamSizeRange, message } =
			await request.json();

		// Find or create user for the submitter
		// If user is logged in, use their ID; otherwise, find or create by email
		let submitterUserId: string;

		if (session?.user?.id) {
			// User is logged in - verify they exist
			const existingUser = await prisma.user.findUnique({
				where: { id: session.user.id },
			});

			if (existingUser) {
				submitterUserId = session.user.id;
			} else {
				// User ID from session doesn't exist in DB - find or create by email
				const userByEmail = await prisma.user.findUnique({
					where: { email: email.toLowerCase() },
				});

				if (userByEmail) {
					submitterUserId = userByEmail.id;
				} else {
					// Create a minimal user record for the submitter
					const newUser = await prisma.user.create({
						data: {
							email: email.toLowerCase(),
							firstName: contactName.split(" ")[0] || contactName,
							lastName: contactName.split(" ").slice(1).join(" ") || "",
							role: "SENDER",
							emailVerified: null, // Will be verified when they set up password
						},
					});
					submitterUserId = newUser.id;
				}
			}
		} else {
			// User is not logged in - find or create by email
			const userByEmail = await prisma.user.findUnique({
				where: { email: email.toLowerCase() },
			});

			if (userByEmail) {
				submitterUserId = userByEmail.id;
			} else {
				// Create a minimal user record for the submitter
				const newUser = await prisma.user.create({
					data: {
						email: email.toLowerCase(),
						firstName: contactName.split(" ")[0] || contactName,
						lastName: contactName.split(" ").slice(1).join(" ") || "",
						role: "SENDER",
						emailVerified: null, // Will be verified when they set up password
					},
				});
				submitterUserId = newUser.id;
			}
		}

		const teamSizeValidation = validateTeamSize(teamSizeRange);
		if (!teamSizeValidation.valid) {
			return NextResponse.json(
				{ error: teamSizeValidation.error },
				{ status: 400 }
			);
		}

		const existingRequest = await prisma.enterpriseRequests.findFirst({
			where: {
				contactEmail: email.toLowerCase(),
			},
			orderBy: {
				createdAt: "desc",
			},
		});

		let entReq;
		let isUpdate = false;
		let customerRequestId: string | null = null;

		if (existingRequest) {
			isUpdate = true;
			customerRequestId =
				existingRequest.customerRequestId ||
				(await generateUniqueCustomerRequestId());

			entReq = await prisma.enterpriseRequests.update({
				where: { id: existingRequest.id },
				data: {
					customerRequestId,
					companyName,
					contactName,
					contactEmail: email,
					teamSize: teamSizeRange,
					message,
					submitter: submitterUserId,
					status: "PENDING",
					updatedAt: new Date(),
				},
			});
		} else {
			// Create new request
			customerRequestId = await generateUniqueCustomerRequestId();

			entReq = await prisma.enterpriseRequests.create({
				data: {
					customerRequestId,
					companyName,
					contactName,
					contactEmail: email,
					teamSize: teamSizeRange,
					message,
					submitter: submitterUserId,
				},
			});
		}

		// Create Stripe customer (but don't create checkout session yet)
		// Checkout will be created when admin approves the request
		let stripeCustomerId: string | null = null;

		try {
			const existingCustomers = await stripe.customers.list({
				email: email,
				limit: 1,
			});

			let customer;
			if (existingCustomers.data.length > 0) {
				customer = existingCustomers.data[0];
			} else {
				customer = await stripe.customers.create({
					email: email,
					name: contactName,
					metadata: {
						userId: submitterUserId,
						companyName: companyName,
						purpose: "enterprise_request",
						customerRequestId: customerRequestId,
					},
				});
			}
			stripeCustomerId = customer.id;

			// Update request with Stripe customer ID
			entReq = await prisma.enterpriseRequests.update({
				where: { id: entReq.id },
				data: {
					stripeCustomerId: stripeCustomerId,
				},
			});
		} catch (stripeError) {
			console.error(
				"Failed to create Stripe customer:",
				stripeError
			);
			// Don't fail the request if Stripe customer creation fails
			// We can create it later when admin approves
		}

		await prisma.enterpriseAuditLog.create({
			data: {
				requestId: entReq.id,
				action: isUpdate ? "UPDATED" : "SUBMITTED",
				userId: submitterUserId,
			},
		});

		const notifType =
			(NotificationType as any).OTHER || NotificationType.REMINDER;

		try {
			const confirmationEmailTemplate =
				renderEnterpriseRequestConfirmation({
					customerRequestId: entReq.customerRequestId || "N/A",
					contactName: contactName || "there",
					companyName,
					email,
					teamSizeRange,
					message,
				});

			const emailSubject = isUpdate
				? "Your Enterprise Request Has Been Updated"
				: "Your Enterprise Request Has Been Received";

			await sendEmail(email, emailSubject, confirmationEmailTemplate);
		} catch (e) {
			console.error("Failed to send confirmation email:", e);
		}

		// Send notification email to admin
		if (process.env.REPLY_EMAIL) {
			try {
				const adminNotificationEmailTemplate =
					renderEnterpriseRequestAdminNotification({
						customerRequestId:
							entReq.customerRequestId || customerRequestId,
						companyName,
						contactName,
						email,
						teamSizeRange,
						message,
					});

				await sendEmail(
					process.env.REPLY_EMAIL,
					"New Enterprise Contact Request",
					adminNotificationEmailTemplate
				);
				console.log(
					"Admin notification email sent successfully to:",
					process.env.REPLY_EMAIL
				);
			} catch (e) {
				console.error("Failed to send admin notification email:", e);
			}
		} else {
			console.warn(
				"REPLY_EMAIL not configured, skipping admin notification email"
			);
		}

		return NextResponse.json(
			{
				success: true,
				requestId: customerRequestId,
				message: "Enterprise request submitted successfully. Our team will review your request and get back to you soon.",
			},
			{ status: 200 }
		);
	} catch (error) {
		console.error("Error processing enterprise contact request:", error);
		return NextResponse.json(
			{ error: "Internal Server Error" },
			{ status: 500 }
		);
	}
}
