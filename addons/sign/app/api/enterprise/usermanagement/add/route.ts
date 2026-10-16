import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { sendEmail } from "@/lib/email";
import { createNotification } from "@/lib/notifications";
import { generateInvitationToken } from "@/lib/invitation-tokens";
import { NotificationType } from "@prisma/client";

export async function PUT(request: Request) {
	const session = await getServerSession(authOptions);
	if (!session) {
		return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
	}

	const enterprise = await prisma.enterpriseAccount.findFirst({
		where: {
			administratorId: session.user?.id,
		},
	});

	if (!enterprise) {
		return NextResponse.json({ error: "Enterprise account not found" }, { status: 404 });
	}

	const { email } = await request.json();

	if (!email || !email.includes("@")) {
		return NextResponse.json({ error: "Valid email is required" }, { status: 400 });
	}

	// Check if user already exists
	const existingUser = await prisma.user.findUnique({
		where: { email },
	});

	if (existingUser) {
		// User exists, add them to enterprise directly
		if (existingUser.enterpriseId === enterprise.id) {
			return NextResponse.json(
				{ error: "User is already a member of this enterprise" },
				{ status: 409 }
			);
		}

		// Add user to enterprise
        // Need to get other user to update subscription status
		await prisma.user.update({
			where: { id: existingUser.id },
			data: {
				enterpriseId: enterprise.id,
				pricingOverride: true,
			},
		});

        await prisma.subscription.updateMany({
            where: { userId: existingUser.id },
            data: {
                status: "INACTIVE",
            },
        });

		await prisma.enterpriseAccount.update({
			where: { id: enterprise.id },
			data: {
				currentUserCount: { increment: 1 },
			},
		});

		// Send notification email
		await sendEmail(
			email,
			`Welcome to ${enterprise.name}`,
			`
			<!DOCTYPE html>
			<html>
			<head>
				<meta charset="utf-8">
				<meta name="viewport" content="width=device-width, initial-scale=1.0">
			</head>
			<body style="margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); padding: 40px 20px;">
				<table role="presentation" style="max-width: 600px; margin: 0 auto; background-color: #ffffff; border-radius: 16px; overflow: hidden; box-shadow: 0 20px 60px rgba(0, 0, 0, 0.3);">
					<!-- Header -->
					<tr>
						<td style="background: linear-gradient(135deg, #2563eb 0%, #4f46e5 100%); padding: 40px 30px; text-align: center;">
							<div style="background-color: rgba(255, 255, 255, 0.2); display: inline-block; padding: 12px; border-radius: 12px; margin-bottom: 16px;">
								<svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
									<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
									<polyline points="14 2 14 8 20 8"></polyline>
									<line x1="16" y1="13" x2="8" y2="13"></line>
									<line x1="16" y1="17" x2="8" y2="17"></line>
									<polyline points="10 9 9 9 8 9"></polyline>
								</svg>
							</div>
							<h1 style="margin: 0; color: #ffffff; font-size: 28px; font-weight: 700; letter-spacing: -0.5px;">SynergySign</h1>
						</td>
					</tr>
					<!-- Content -->
					<tr>
						<td style="padding: 40px 30px;">
							<h2 style="margin: 0 0 16px 0; color: #1e293b; font-size: 24px; font-weight: 600;">Welcome to ${enterprise.name}! 🎉</h2>
							<p style="margin: 0 0 20px 0; color: #475569; font-size: 16px; line-height: 1.6;">Great news! You've been successfully added to the <strong style="color: #1e293b;">${enterprise.name}</strong> enterprise account.</p>
							<p style="margin: 0 0 30px 0; color: #475569; font-size: 16px; line-height: 1.6;">You now have access to all enterprise features including advanced document management, team collaboration tools, and priority support.</p>
							<!-- CTA Button -->
							<table role="presentation" style="margin: 0 auto;">
								<tr>
									<td style="text-align: center;">
										<a href="${process.env.NEXTAUTH_URL}/auth/login" style="display: inline-block; background: linear-gradient(135deg, #2563eb 0%, #4f46e5 100%); color: #ffffff; text-decoration: none; padding: 14px 32px; border-radius: 8px; font-weight: 600; font-size: 16px; box-shadow: 0 4px 12px rgba(37, 99, 235, 0.3); transition: transform 0.2s;">Log In to Your Account</a>
									</td>
								</tr>
							</table>
							<div style="margin-top: 30px; padding: 16px; background: linear-gradient(135deg, #eff6ff 0%, #eef2ff 100%); border-radius: 8px; border-left: 4px solid #2563eb;">
								<p style="margin: 0; color: #1e40af; font-size: 14px; line-height: 1.5;">💡 <strong>Quick Tip:</strong> If the changes don't take effect immediately, please log out and back in to refresh your session.</p>
							</div>
						</td>
					</tr>
					<!-- Footer -->
					<tr>
						<td style="background: linear-gradient(135deg, #f8fafc 0%, #f1f5f9 100%); padding: 30px; text-align: center; border-top: 1px solid #e2e8f0;">
							<p style="margin: 0 0 8px 0; color: #64748b; font-size: 14px;">Need help? Contact us at <a href="mailto:support@synergysign.com" style="color: #2563eb; text-decoration: none;">support@synergysign.com</a></p>
							<p style="margin: 0; color: #94a3b8; font-size: 12px;">&copy; 2025 SynergySign. All rights reserved.</p>
						</td>
					</tr>
				</table>
			</body>
			</html>
			`
		);

		// Create notification
		await createNotification(
			existingUser.email,
			"Welcome to your new enterprise",
			`You've been added to the ${enterprise.name} enterprise account.`,
			NotificationType.OTHER,
		);

		// Notify administrator of successful addition
		await sendEmail(
			session.user.email,
			`User Added to ${enterprise.name}`,
			`
			<!DOCTYPE html>
			<html>
			<head>
				<meta charset="utf-8" />
				<meta name="viewport" content="width=device-width, initial-scale=1.0" />
			</head>
			<body style="margin:0;padding:40px 20px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif;background:linear-gradient(135deg,#667eea 0%,#764ba2 100%);">
				<table role="presentation" style="max-width:600px;margin:0 auto;background:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 20px 60px rgba(0,0,0,0.3);">
					<tr>
						<td style="background:linear-gradient(135deg,#2563eb 0%,#4f46e5 100%);padding:36px 30px;text-align:center;">
							<h1 style="margin:0;color:#ffffff;font-size:26px;font-weight:700;letter-spacing:-0.5px;">SynergySign • Admin Notice</h1>
						</td>
					</tr>
					<tr>
						<td style="padding:38px 34px;">
							<h2 style="margin:0 0 16px;color:#1e293b;font-size:22px;font-weight:600;">User Added Successfully</h2>
							<p style="margin:0 0 18px;color:#475569;font-size:15px;line-height:1.6;">The user <strong style="color:#1e293b;">${existingUser.email}</strong> has been added to the <strong style="color:#1e293b;">${enterprise.name}</strong> enterprise account.</p>
							<p style="margin:0 0 24px;color:#475569;font-size:15px;line-height:1.6;">They now have enterprise feature access. Current user count has been incremented.</p>
							<table role="presentation" style="margin:0 0 24px;width:100%;border-collapse:collapse;">
								<tr style="background:linear-gradient(135deg,#eff6ff 0%,#eef2ff 100%);">
									<td style="padding:12px 16px;font-size:13px;color:#1e40af;font-weight:600;border-left:4px solid #2563eb;">User Email</td>
									<td style="padding:12px 16px;font-size:13px;color:#1e293b;">${existingUser.email}</td>
								</tr>
								<tr>
									<td style="padding:12px 16px;font-size:13px;color:#64748b;font-weight:600;border-left:4px solid #2563eb;background:#f8fafc;">User ID</td>
									<td style="padding:12px 16px;font-size:13px;color:#1e293b;background:#f8fafc;">${existingUser.id}</td>
								</tr>
							</table>
							<table role="presentation" style="margin:0 auto;">
								<tr>
									<td style="text-align:center;">
										<a href="${process.env.NEXTAUTH_URL}/dashboard/enterprise/" style="display:inline-block;background:linear-gradient(135deg,#2563eb 0%,#4f46e5 100%);color:#ffffff;text-decoration:none;padding:12px 28px;border-radius:8px;font-weight:600;font-size:14px;box-shadow:0 4px 12px rgba(37,99,235,0.3);">Manage Users</a>
									</td>
								</tr>
							</table>
						</td>
					</tr>
					<tr>
						<td style="background:linear-gradient(135deg,#f8fafc 0%,#f1f5f9 100%);padding:26px 30px;text-align:center;border-top:1px solid #e2e8f0;">
							<p style="margin:0 0 6px;color:#64748b;font-size:13px;">This is an administrative notification.</p>
							<p style="margin:0;color:#94a3b8;font-size:11px;">&copy; 2025 SynergySign. All rights reserved.</p>
						</td>
					</tr>
				</table>
			</body>
			</html>
			`
		);

		await createNotification(
			session.user.email,
			"User added to enterprise",
			`${existingUser.email} was added to the enterprise account successfully.`,
			NotificationType.OTHER,
		);

		return NextResponse.json({
			message: "User added to enterprise successfully",
			userId: existingUser.id,
		});
	}

	// User doesn't exist, create invitation
	// Check if there's already a pending invitation
	const existingInvitation = await prisma.enterpriseInvitation.findFirst({
		where: {
			email,
			enterpriseId: enterprise.id,
			usedAt: null,
			expiresAt: { gt: new Date() },
		},
	});

	if (existingInvitation) {
		return NextResponse.json(
			{ error: "An invitation has already been sent to this email" },
			{ status: 409 }
		);
	}

	// Generate invitation token
	const token = generateInvitationToken();
	const expiresAt = new Date();
	expiresAt.setDate(expiresAt.getDate() + 7); // Token expires in 7 days

	// Create invitation record
	await prisma.enterpriseInvitation.create({
		data: {
			token,
			email,
			enterpriseId: enterprise.id,
			invitedBy: session.user.id,
			expiresAt,
		},
	});

	// Send invitation email
	const invitationUrl = `${process.env.NEXTAUTH_URL}/auth/signup?invitation=${token}`;

	await sendEmail(
		email,
		`You're invited to join ${enterprise.name}`,
		`
		<!DOCTYPE html>
		<html>
		<head>
			<meta charset="utf-8">
			<meta name="viewport" content="width=device-width, initial-scale=1.0">
		</head>
		<body style="margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); padding: 40px 20px;">
			<table role="presentation" style="max-width: 600px; margin: 0 auto; background-color: #ffffff; border-radius: 16px; overflow: hidden; box-shadow: 0 20px 60px rgba(0, 0, 0, 0.3);">
				<!-- Header -->
				<tr>
					<td style="background: linear-gradient(135deg, #2563eb 0%, #4f46e5 100%); padding: 40px 30px; text-align: center;">
						<div style="background-color: rgba(255, 255, 255, 0.2); display: inline-block; padding: 12px; border-radius: 12px; margin-bottom: 16px;">
							<svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
								<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
								<polyline points="14 2 14 8 20 8"></polyline>
								<line x1="16" y1="13" x2="8" y2="13"></line>
								<line x1="16" y1="17" x2="8" y2="17"></line>
								<polyline points="10 9 9 9 8 9"></polyline>
							</svg>
						</div>
						<h1 style="margin: 0; color: #ffffff; font-size: 28px; font-weight: 700; letter-spacing: -0.5px;">SynergySign</h1>
					</td>
				</tr>
				<!-- Content -->
				<tr>
					<td style="padding: 40px 30px;">
						<h2 style="margin: 0 0 16px 0; color: #1e293b; font-size: 24px; font-weight: 600;">You're Invited! ✉️</h2>
						<p style="margin: 0 0 20px 0; color: #475569; font-size: 16px; line-height: 1.6;">You've been invited to join <strong style="color: #1e293b;">${enterprise.name}</strong> on SynergySign.</p>
						<p style="margin: 0 0 30px 0; color: #475569; font-size: 16px; line-height: 1.6;">Click the button below to create your account and start collaborating with your team on document signing and management.</p>
						<!-- CTA Button -->
						<table role="presentation" style="margin: 0 auto;">
							<tr>
								<td style="text-align: center;">
									<a href="${invitationUrl}" style="display: inline-block; background: linear-gradient(135deg, #2563eb 0%, #4f46e5 100%); color: #ffffff; text-decoration: none; padding: 14px 32px; border-radius: 8px; font-weight: 600; font-size: 16px; box-shadow: 0 4px 12px rgba(37, 99, 235, 0.3); transition: transform 0.2s;">Accept Invitation</a>
								</td>
							</tr>
						</table>
						<!-- Alternative Link -->
						<div style="margin-top: 30px; padding: 16px; background-color: #f8fafc; border-radius: 8px; border: 1px solid #e2e8f0;">
							<p style="margin: 0 0 8px 0; color: #64748b; font-size: 13px; font-weight: 600;">Or copy this link:</p>
							<p style="margin: 0; color: #2563eb; font-size: 13px; word-break: break-all; font-family: monospace;">${invitationUrl}</p>
						</div>
						<!-- Expiration Notice -->
						<div style="margin-top: 24px; padding: 16px; background: linear-gradient(135deg, #fef3c7 0%, #fde68a 100%); border-radius: 8px; border-left: 4px solid #f59e0b;">
							<p style="margin: 0; color: #92400e; font-size: 14px; line-height: 1.5;">⏰ <strong>Important:</strong> This invitation expires in 7 days. Please accept it soon!</p>
						</div>
					</td>
				</tr>
				<!-- Footer -->
				<tr>
					<td style="background: linear-gradient(135deg, #f8fafc 0%, #f1f5f9 100%); padding: 30px; text-align: center; border-top: 1px solid #e2e8f0;">
						<p style="margin: 0 0 8px 0; color: #64748b; font-size: 14px;">Need help? Contact us at <a href="mailto:support@synergysign.com" style="color: #2563eb; text-decoration: none;">support@synergysign.com</a></p>
						<p style="margin: 0; color: #94a3b8; font-size: 12px;">&copy; 2025 SynergySign. All rights reserved.</p>
					</td>
				</tr>
			</table>
		</body>
		</html>
		`
	);

	await createNotification(
		email,
		"Welcome to your new enterprise",
		`You've been added to the ${enterprise.name} enterprise account.`,
		NotificationType.OTHER,
	);

	// Notify administrator of invitation sent
	await sendEmail(
		session.user.email,
		`Invitation Sent: ${email}`,
		`
		<!DOCTYPE html>
		<html>
		<head>
			<meta charset="utf-8" />
			<meta name="viewport" content="width=device-width, initial-scale=1.0" />
		</head>
		<body style="margin:0;padding:40px 20px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif;background:linear-gradient(135deg,#667eea 0%,#764ba2 100%);">
			<table role="presentation" style="max-width:600px;margin:0 auto;background:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 20px 60px rgba(0,0,0,0.3);">
				<tr>
					<td style="background:linear-gradient(135deg,#2563eb 0%,#4f46e5 100%);padding:34px 30px;text-align:center;">
						<h1 style="margin:0;color:#ffffff;font-size:26px;font-weight:700;letter-spacing:-0.5px;">SynergySign • Invitation Sent</h1>
					</td>
				</tr>
				<tr>
					<td style="padding:38px 34px;">
						<h2 style="margin:0 0 16px;color:#1e293b;font-size:22px;font-weight:600;">Invitation Details</h2>
						<p style="margin:0 0 18px;color:#475569;font-size:15px;line-height:1.6;">An invitation was sent to <strong style="color:#1e293b;">${email}</strong> to join <strong style="color:#1e293b;">${enterprise.name}</strong>.</p>
						<p style="margin:0 0 24px;color:#475569;font-size:15px;line-height:1.6;">The invitation link expires in <strong>7 days</strong>. You will be notified once they accept and register.</p>
						<table role="presentation" style="margin:0 0 24px;width:100%;border-collapse:collapse;">
							<tr style="background:linear-gradient(135deg,#eff6ff 0%,#eef2ff 100%);">
								<td style="padding:12px 16px;font-size:13px;color:#1e40af;font-weight:600;border-left:4px solid #2563eb;">Invitee Email</td>
								<td style="padding:12px 16px;font-size:13px;color:#1e293b;">${email}</td>
							</tr>
							<tr>
								<td style="padding:12px 16px;font-size:13px;color:#64748b;font-weight:600;border-left:4px solid #2563eb;background:#f8fafc;">Token</td>
								<td style="padding:12px 16px;font-size:13px;color:#1e293b;background:#f8fafc;">${token}</td>
							</tr>
						</table>
						<table role="presentation" style="margin:0 auto;">
							<tr>
								<td style="text-align:center;">
									<a href="${process.env.NEXTAUTH_URL}/dashboard/enterprise/" style="display:inline-block;background:linear-gradient(135deg,#2563eb 0%,#4f46e5 100%);color:#ffffff;text-decoration:none;padding:12px 28px;border-radius:8px;font-weight:600;font-size:14px;box-shadow:0 4px 12px rgba(37,99,235,0.3);">View Invitations</a>
								</td>
							</tr>
						</table>
					</td>
				</tr>
				<tr>
					<td style="background:linear-gradient(135deg,#f8fafc 0%,#f1f5f9 100%);padding:26px 30px;text-align:center;border-top:1px solid #e2e8f0;">
						<p style="margin:0 0 6px;color:#64748b;font-size:13px;">This is an administrative notification.</p>
						<p style="margin:0;color:#94a3b8;font-size:11px;">&copy; 2025 SynergySign. All rights reserved.</p>
					</td>
				</tr>
			</table>
		</body>
		</html>
		`
	);

	await createNotification(
		session.user.email,
		"Invitation sent",
		`Invitation sent to ${email} with token ending in ${token.slice(-6)}.`,
		NotificationType.OTHER,
	);

	return NextResponse.json({
		message: "Invitation sent successfully",
		invitationToken: token,
	});
}