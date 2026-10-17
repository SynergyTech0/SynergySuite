import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from "@/lib/auth";
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { createNotification } from '@/lib/notifications';
import { sendEmail } from '@/lib/email';
import { NotificationType } from '@prisma/client';
import { publicBase } from "@/lib/urls";

export async function POST(request: NextRequest) {
    const session = await getServerSession(authOptions);

    if (!session || !session.user.id) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const enterprise = await prisma.enterpriseAccount.findFirst({
        where: {
            administratorId: session.user.id,
        },
    });

    if (!enterprise) {
        return NextResponse.json({ error: 'Enterprise account not found' }, { status: 404 });
    }

    const { userId } = await request.json();

    if (!userId) {
        return NextResponse.json({ error: 'User ID is required' }, { status: 400 });
    }

    const user = await prisma.user.findUnique({
        where: { id: userId },
    });

    if (!user || user.enterpriseId !== enterprise.id) {
        return NextResponse.json({ error: 'User not found in this enterprise' }, { status: 404 });
    }

    // Reassign user's documents and templates to the enterprise administrator
    const adminId = enterprise.administratorId;
    await prisma.document.updateMany({
        where: { senderId: userId },
        data: { senderId: adminId ?? session.user.id },
    });

    await prisma.template.updateMany({
        where: { creatorId: userId },
        data: { creatorId: adminId ?? session.user.id },
    });

    // Create a new subscription for the user if they don't have one
    const currentSubscription = await prisma.subscription.findFirst({
        where: { userId: user.id },
    });

    if (!currentSubscription) {
        await prisma.subscription.create({
            data: {
                userId: user.id,
                status: 'INACTIVE',
                tier: 'FREE',
                currentPeriodStart: new Date(),
                currentPeriodEnd: new Date(), // Make it automatically expired
            },
        });
    }

    await prisma.user.update({
        where: { id: userId },
        data: {
            enterpriseId: null,
            pricingOverride: false,
        },
    });

    await prisma.enterpriseAccount.update({
        where: { id: enterprise.id },
        data: {
            currentUserCount: { decrement: 1 },
        },
    });

    await createNotification(
        user.email,
        "Removed from Enterprise",
        `You have been removed from the ${enterprise.name} enterprise account.`,
        NotificationType.OTHER,
    );

    await sendEmail(
        user.email,
        'You have been removed from your enterprise account',
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
                        <h2 style="margin: 0 0 16px 0; color: #1e293b; font-size: 24px; font-weight: 600;">Enterprise Account Update</h2>
                        <p style="margin: 0 0 20px 0; color: #475569; font-size: 16px; line-height: 1.6;">Hello ${user.name || 'there'},</p>
                        <p style="margin: 0 0 20px 0; color: #475569; font-size: 16px; line-height: 1.6;">We're writing to inform you that you have been removed from the <strong style="color: #1e293b;">${enterprise.name}</strong> enterprise account.</p>
                        <p style="margin: 0 0 30px 0; color: #475569; font-size: 16px; line-height: 1.6;">Your personal account remains active, and you can continue using SynergySign with your individual subscription.</p>
                        <!-- Info Box -->
                        <div style="margin-top: 30px; padding: 16px; background: linear-gradient(135deg, #fef2f2 0%, #fee2e2 100%); border-radius: 8px; border-left: 4px solid #ef4444;">
                            <p style="margin: 0; color: #991b1b; font-size: 14px; line-height: 1.5;"><strong>Questions?</strong> If you believe this is a mistake, please contact your enterprise administrator.</p>
                        </div>
                        <!-- CTA Button -->
                        <table role="presentation" style="margin: 30px auto 0 auto;">
                            <tr>
                                <td style="text-align: center;">
                                    <a href="${publicBase()}/dashboard" style="display: inline-block; background: linear-gradient(135deg, #2563eb 0%, #4f46e5 100%); color: #ffffff; text-decoration: none; padding: 14px 32px; border-radius: 8px; font-weight: 600; font-size: 16px; box-shadow: 0 4px 12px rgba(37, 99, 235, 0.3); transition: transform 0.2s;">Go to Dashboard</a>
                                </td>
                            </tr>
                        </table>
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

    // Notify administrator of removal
    await sendEmail(
        session.user.email,
        `User Removed: ${user.email}`,
        `
        <!DOCTYPE html>
        <html>
        <head>
            <meta charset="utf-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
        </head>
        <body style="margin:0;padding:40px 20px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif;background:linear-gradient(135deg,#667eea 0%,#764ba2 100%);">
            <table role="presentation" style="max-width:600px;margin:0 auto;background:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 20px 60px rgba(0,0,0,0.3);">
                <tr>
                    <td style="background:linear-gradient(135deg,#2563eb 0%,#4f46e5 100%);padding:34px 30px;text-align:center;">
                        <h1 style="margin:0;color:#ffffff;font-size:26px;font-weight:700;letter-spacing:-0.5px;">SynergySign • Removal Notice</h1>
                    </td>
                </tr>
                <tr>
                    <td style="padding:38px 34px;">
                        <h2 style="margin:0 0 16px;color:#1e293b;font-size:22px;font-weight:600;">User Removed From Enterprise</h2>
                        <p style="margin:0 0 18px;color:#475569;font-size:15px;line-height:1.6;">The user <strong style="color:#1e293b;">${user.email}</strong> has been removed from <strong style="color:#1e293b;">${enterprise.name}</strong>.</p>
                        <p style="margin:0 0 24px;color:#475569;font-size:15px;line-height:1.6;">Their individual account remains active. Documents and templates were reassigned to you as administrator.</p>
                        <table role="presentation" style="margin:0 0 24px;width:100%;border-collapse:collapse;">
                            <tr style="background:linear-gradient(135deg,#eff6ff 0%,#eef2ff 100%);">
                                <td style="padding:12px 16px;font-size:13px;color:#1e40af;font-weight:600;border-left:4px solid #2563eb;">User Email</td>
                                <td style="padding:12px 16px;font-size:13px;color:#1e293b;">${user.email}</td>
                            </tr>
                            <tr>
                                <td style="padding:12px 16px;font-size:13px;color:#64748b;font-weight:600;border-left:4px solid #2563eb;background:#f8fafc;">User ID</td>
                                <td style="padding:12px 16px;font-size:13px;color:#1e293b;background:#f8fafc;">${user.id}</td>
                            </tr>
                        </table>
                        <table role="presentation" style="margin:0 auto;">
                            <tr>
                                <td style="text-align:center;">
                                    <a href="${publicBase()}/dashboard/enterprise/" style="display:inline-block;background:linear-gradient(135deg,#2563eb 0%,#4f46e5 100%);color:#ffffff;text-decoration:none;padding:12px 28px;border-radius:8px;font-weight:600;font-size:14px;box-shadow:0 4px 12px rgba(37,99,235,0.3);">Manage Users</a>
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
        "User removed from enterprise",
        `${user.email} was removed from the enterprise account successfully.`,
        NotificationType.OTHER,
    );

    return NextResponse.json({ message: 'User removed from enterprise' });
}