/**
 * Email template for enterprise request approval
 * Sent to the customer when their enterprise request is approved
 */

import { renderBaseEmailLayout } from "./base-layout";

export interface EnterpriseRequestApprovedData {
  customerRequestId: string;
  contactName: string;
  companyName: string;
  teamSizeRange: string | number;
  message?: string;
  passwordSetupUrl?: string;
  paymentUrl?: string;
}

export function renderEnterpriseRequestApproved(
  data: EnterpriseRequestApprovedData
): string {
  const {
    customerRequestId,
    contactName,
    companyName,
    teamSizeRange,
    passwordSetupUrl,
    paymentUrl,
  } = data;

  // Build content HTML
  const content = `
              <!-- Greeting -->
              <p style="margin:0 0 20px; font-size:16px; line-height:1.6; color:#1f2937;">
                Dear ${contactName},
              </p>

              <!-- Main Message -->
              <p style="margin:0 0 24px; font-size:16px; line-height:1.7; color:#374151;">
                We're pleased to inform you that your enterprise plan request has been <strong style="color:#059669; font-weight:600;">approved</strong>. Your organization <strong style="color:#1f2937;">${companyName}</strong> is now ready to get started with SynergySign Enterprise.
              </p>

              ${paymentUrl ? `
              <!-- Payment CTA -->
              <div style="background-color:#f0f9ff; border:2px solid #2563eb; border-radius:8px; padding:24px; margin:28px 0;">
                <h3 style="margin:0 0 12px; font-size:18px; font-weight:700; color:#111827; letter-spacing:-0.2px;">Complete Your Payment</h3>
                <p style="margin:0 0 16px; font-size:15px; color:#374151; line-height:1.6;">
                  To activate your enterprise account, please complete your payment of <strong style="color:#2563eb; font-size:18px;">$49.99 USD</strong>. After payment, you'll receive a confirmation email with your password setup link.
                </p>
                <p style="margin:0 0 20px; font-size:14px; color:#6b7280; line-height:1.6;">
                  This payment link will expire in 7 days for security purposes.
                </p>
                <div>
                  <a href="${paymentUrl}" style="display:inline-block; background-color:#2563eb; color:#ffffff; text-decoration:none; font-weight:600; font-size:15px; padding:12px 28px; border-radius:6px; text-align:center;">
                    Proceed to Payment
                  </a>
                </div>
              </div>
              ` : passwordSetupUrl ? `
              <!-- Password Setup CTA -->
              <div style="background-color:#ffffff; border:1px solid #e5e7eb; border-radius:8px; padding:24px; margin:28px 0;">
                <h3 style="margin:0 0 12px; font-size:18px; font-weight:700; color:#111827; letter-spacing:-0.2px;">Complete Your Account Setup</h3>
                <p style="margin:0 0 20px; font-size:15px; color:#374151; line-height:1.6;">
                  To activate your enterprise account, please set up your password using the secure link below. This link will expire in 7 days for security purposes.
                </p>
                <div>
                  <a href="${passwordSetupUrl}" style="display:inline-block; background-color:#2563eb; color:#ffffff; text-decoration:none; font-weight:600; font-size:15px; padding:12px 28px; border-radius:6px;">
                    Set Up Password
                  </a>
                </div>
              </div>
              ` : ''}

              <!-- Request Details -->
              <div style="border:1px solid #e5e7eb; border-radius:8px; padding:24px; margin:28px 0;">
                <h2 style="margin:0 0 20px; font-size:17px; font-weight:700; color:#111827; letter-spacing:-0.2px;">Request Information</h2>
                <div style="margin-bottom:16px; padding-bottom:16px; border-bottom:1px solid #f3f4f6;">
                  <div style="color:#6b7280; font-size:12px; font-weight:600; text-transform:uppercase; letter-spacing:0.5px; margin-bottom:4px;">Request ID</div>
                  <div style="color:#111827; font-size:15px; font-weight:600; font-family:monospace;">${customerRequestId}</div>
                </div>
                <div style="margin-bottom:16px; padding-bottom:16px; border-bottom:1px solid #f3f4f6;">
                  <div style="color:#6b7280; font-size:12px; font-weight:600; text-transform:uppercase; letter-spacing:0.5px; margin-bottom:4px;">Company Name</div>
                  <div style="color:#111827; font-size:15px; font-weight:600;">${companyName}</div>
                </div>
                <div style="margin-bottom:16px; padding-bottom:16px; border-bottom:1px solid #f3f4f6;">
                  <div style="color:#6b7280; font-size:12px; font-weight:600; text-transform:uppercase; letter-spacing:0.5px; margin-bottom:4px;">Contact Person</div>
                  <div style="color:#111827; font-size:15px; font-weight:500;">${contactName}</div>
                </div>
                <div>
                  <div style="color:#6b7280; font-size:12px; font-weight:600; text-transform:uppercase; letter-spacing:0.5px; margin-bottom:4px;">Team Size</div>
                  <div style="color:#111827; font-size:15px; font-weight:500;">
                    <span style="display:inline-block; background-color:#eff6ff; color:#1e40af; padding:4px 12px; border-radius:4px; font-size:14px; font-weight:600;">
                      ${teamSizeRange} users
                    </span>
                  </div>
                </div>
              </div>

              <!-- Support Section -->
              <div style="border:1px solid #e5e7eb; border-left:3px solid #2563eb; border-radius:6px; padding:20px; margin:28px 0; background-color:#ffffff;">
                <h3 style="margin:0 0 12px; font-size:16px; font-weight:700; color:#111827; letter-spacing:-0.1px;">Need Assistance?</h3>
                <p style="margin:0 0 12px; font-size:14px; color:#374151; line-height:1.6;">
                  Our dedicated support team is ready to help you get started. If you have any questions or need assistance with your account setup, please don't hesitate to reach out.
                </p>
                <p style="margin:0; font-size:14px; color:#374151; line-height:1.6;">
                  <strong style="color:#111827;">Email:</strong> <a href="mailto:sales@synergysign.com" style="color:#2563eb; text-decoration:none; font-weight:500;">sales@synergysign.com</a>
                </p>
              </div>

              <!-- Closing -->
              <p style="margin:24px 0 0; font-size:16px; line-height:1.7; color:#374151;">
                We're excited to partner with you and look forward to supporting your team's success with SynergySign Enterprise.
              </p>
              <p style="margin:20px 0 0; font-size:16px; line-height:1.7; color:#374151;">
                Best regards,<br>
                <strong style="color:#1f2937;">The SynergySign Team</strong>
              </p>
  `.trim();

  // Use base layout
  return renderBaseEmailLayout({
    preheaderText: `Your enterprise request (${customerRequestId}) has been approved. Complete your account setup to get started.`,
    headerIcon: "✓",
    headerTitle: "Enterprise Request Approved",
    headerSubtitle: "Welcome to SynergySign Enterprise",
    content,
    footerText: "SynergySign",
    footerSubtext: `© ${new Date().getFullYear()} Synergy Technologies LLC. All rights reserved.`,
  });
}
