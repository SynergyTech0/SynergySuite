/**
 * Email template for enterprise request confirmation
 * Sent to the user who submitted an enterprise contact request
 */

import { renderBaseEmailLayout } from "./base-layout";

export interface EnterpriseRequestConfirmationData {
  customerRequestId: string;
  contactName: string;
  companyName: string;
  email: string;
  teamSizeRange: string | number;
  message?: string;
}

export function renderEnterpriseRequestConfirmation(
  data: EnterpriseRequestConfirmationData
): string {
  const {
    customerRequestId,
    contactName,
    companyName,
    teamSizeRange,
    message,
  } = data;

  // Build content HTML
  const content = `
              <!-- Greeting -->
              <p style="margin:0 0 20px; font-size:16px; line-height:1.6; color:#1f2937;">
                Dear ${contactName},
              </p>

              <!-- Main Message -->
              <p style="margin:0 0 24px; font-size:16px; line-height:1.7; color:#374151;">
                Thank you for your interest in our Enterprise plan. Your request <strong style="color:#111827;">(ID: ${customerRequestId})</strong> has been received and is under review.
              </p>

              <p style="margin:0 0 24px; font-size:16px; line-height:1.7; color:#374151;">
                You'll receive an update once our team reviews your request. We typically respond within 24-48 hours.
              </p>

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
                <div${message ? ' style="margin-bottom:16px; padding-bottom:16px; border-bottom:1px solid #f3f4f6;"' : ''}>
                  <div style="color:#6b7280; font-size:12px; font-weight:600; text-transform:uppercase; letter-spacing:0.5px; margin-bottom:4px;">Team Size</div>
                  <div style="color:#111827; font-size:15px; font-weight:500;">
                    <span style="display:inline-block; background-color:#eff6ff; color:#1e40af; padding:4px 12px; border-radius:4px; font-size:14px; font-weight:600;">
                      ${teamSizeRange} users
                    </span>
                  </div>
                </div>
                ${message ? `
                <div style="margin-top:16px; padding-top:16px; border-top:1px solid #f3f4f6;">
                  <div style="color:#6b7280; font-size:12px; font-weight:600; text-transform:uppercase; letter-spacing:0.5px; margin-bottom:8px;">Your Message</div>
                  <div style="background-color:#f9fafb; border-left:3px solid #2563eb; padding:16px; border-radius:6px;">
                    <p style="margin:0; font-size:15px; color:#374151; line-height:1.7; white-space:pre-wrap;">${message}</p>
                  </div>
                </div>
                ` : ''}
              </div>

              <!-- Support Section -->
              <div style="border:1px solid #e5e7eb; border-left:3px solid #2563eb; border-radius:6px; padding:20px; margin:28px 0; background-color:#ffffff;">
                <h3 style="margin:0 0 12px; font-size:16px; font-weight:700; color:#111827; letter-spacing:-0.1px;">Questions or Concerns?</h3>
                <p style="margin:0 0 12px; font-size:14px; color:#374151; line-height:1.6;">
                  If you have any questions, please don't hesitate to reach out to us.
                </p>
                <p style="margin:0; font-size:14px; color:#374151; line-height:1.6;">
                  <strong style="color:#111827;">Email:</strong> <a href="mailto:sales@synergysign.com" style="color:#2563eb; text-decoration:none; font-weight:500;">sales@synergysign.com</a>
                </p>
              </div>

              <!-- Closing -->
              <p style="margin:24px 0 0; font-size:16px; line-height:1.7; color:#374151;">
                We look forward to working with you.
              </p>
              <p style="margin:20px 0 0; font-size:16px; line-height:1.7; color:#374151;">
                Best regards,<br>
                <strong style="color:#1f2937;">The SynergySign Team</strong>
              </p>
  `.trim();

  return renderBaseEmailLayout({
    preheaderText: `Your enterprise request (${customerRequestId}) has been received and is under review.`,
    headerIcon: "",
    headerTitle: "Your Enterprise Request Has Been Received",
    headerSubtitle: "We'll review your request and get back to you soon",
    content,
    footerText: "SynergySign",
    footerSubtext: `© ${new Date().getFullYear()} Synergy Technologies LLC. All rights reserved.`,
  });
}
