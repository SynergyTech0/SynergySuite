/**
 * Email template for admin notification when a new enterprise request is submitted
 * Sent to the admin email address configured in REPLY_EMAIL
 */

import { renderBaseEmailLayout } from "./base-layout";

export interface EnterpriseRequestAdminNotificationData {
  customerRequestId: string;
  companyName: string;
  contactName: string;
  email: string;
  teamSizeRange: string | number;
  message?: string;
}

export function renderEnterpriseRequestAdminNotification(
  data: EnterpriseRequestAdminNotificationData
): string {
  const {
    customerRequestId,
    companyName,
    contactName,
    email,
    teamSizeRange,
    message,
  } = data;

  const timestamp = new Date().toLocaleString("en-US", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZoneName: "short",
  });

  const redirectUrl = `${process.env.NEXTAUTH_URL || ""}/admin/enterprises`;

  const content = `
              <p style="margin:0 0 24px; font-size:16px; line-height:1.7; color:#374151;">
                A new request from <strong style="color:#111827;">${companyName}</strong> (<strong style="color:#111827;">${contactName}</strong>) (<strong style="color:#111827;">${customerRequestId}</strong>) is pending review.
              </p>

              <!-- Combined Details and Message Section -->
              <table role="presentation" style="width:100%; border-collapse:collapse; margin:28px 0;">
                <tr>
                  <td style="background-color:#f9fafb; border:2px solid #e5e7eb; border-radius:10px; padding:0; overflow:hidden;">
                    
                    <!-- Section Header -->
                    <table role="presentation" style="width:100%; border-collapse:collapse;">
                      <tr>
                        <td style="padding:20px 24px; background-color:#f3f4f6; border-bottom:2px solid #e5e7eb;">
                          <h2 style="margin:0; font-size:18px; font-weight:700; color:#111827; letter-spacing:-0.3px;">Request Details</h2>
                        </td>
                      </tr>
                    </table>

                    <!-- Details Rows -->
                    <table role="presentation" style="width:100%; border-collapse:collapse;">
                      <tr>
                        <td style="padding:18px 24px; border-bottom:1px solid #e5e7eb;">
                          <table role="presentation" style="width:100%; border-collapse:collapse;">
                            <tr>
                              <td style="width:140px; color:#6b7280; font-size:13px; font-weight:600; text-transform:uppercase; letter-spacing:0.5px; vertical-align:top; padding-top:2px;">Customer Request ID</td>
                              <td style="color:#111827; font-size:16px; font-weight:600;">${customerRequestId}</td>
                            </tr>
                          </table>
                        </td>
                      </tr>
                      <tr>
                        <td style="padding:18px 24px; border-bottom:1px solid #e5e7eb; background-color:#fafafa;">
                          <table role="presentation" style="width:100%; border-collapse:collapse;">
                            <tr>
                              <td style="width:140px; color:#6b7280; font-size:13px; font-weight:600; text-transform:uppercase; letter-spacing:0.5px; vertical-align:top; padding-top:2px;">Company</td>
                              <td style="color:#111827; font-size:16px; font-weight:600;">${companyName}</td>
                            </tr>
                          </table>
                        </td>
                      </tr>
                      <tr>
                        <td style="padding:18px 24px; border-bottom:1px solid #e5e7eb;">
                          <table role="presentation" style="width:100%; border-collapse:collapse;">
                            <tr>
                              <td style="width:140px; color:#6b7280; font-size:13px; font-weight:600; text-transform:uppercase; letter-spacing:0.5px; vertical-align:top; padding-top:2px;">Contact</td>
                              <td style="color:#111827; font-size:15px; font-weight:500;">${contactName}</td>
                            </tr>
                          </table>
                        </td>
                      </tr>
                      <tr>
                        <td style="padding:18px 24px; border-bottom:1px solid #e5e7eb; background-color:#fafafa;">
                          <table role="presentation" style="width:100%; border-collapse:collapse;">
                            <tr>
                              <td style="width:140px; color:#6b7280; font-size:13px; font-weight:600; text-transform:uppercase; letter-spacing:0.5px; vertical-align:top; padding-top:2px;">Email</td>
                              <td style="font-size:15px; font-weight:500;">
                                <a href="mailto:${email}" style="color:#3b82f6; text-decoration:none; border-bottom:1px solid rgba(59,130,246,0.3);">${email}</a>
                              </td>
                            </tr>
                          </table>
                        </td>
                      </tr>
                      <tr>
                        <td style="padding:18px 24px; ${
                          message ? "border-bottom:1px solid #e5e7eb;" : ""
                        }">
                          <table role="presentation" style="width:100%; border-collapse:collapse;">
                            <tr>
                              <td style="width:140px; color:#6b7280; font-size:13px; font-weight:600; text-transform:uppercase; letter-spacing:0.5px; vertical-align:top; padding-top:2px;">Team Size</td>
                              <td style="color:#111827; font-size:15px; font-weight:500;">
                                <span style="display:inline-block; background-color:#dbeafe; color:#1e40af; padding:4px 12px; border-radius:20px; font-size:14px; font-weight:600;">
                                  ${teamSizeRange} users
                                </span>
                              </td>
                            </tr>
                          </table>
                        </td>
                      </tr>
                      ${
                        message
                          ? `
                      <tr>
                        <td style="padding:24px 24px; background-color:#fafafa; border-top:2px solid #e5e7eb;">
                          <h3 style="margin:0 0 14px; font-size:16px; font-weight:700; color:#111827; letter-spacing:-0.2px;">Customer Message</h3>
                          <table role="presentation" style="width:100%; border-collapse:collapse;">
                            <tr>
                              <td style="background-color:#ffffff; border-left:4px solid #3b82f6; padding:20px; border-radius:8px;">
                                <p style="margin:0; font-size:15px; color:#374151; line-height:1.7; white-space:pre-wrap; font-style:italic;">"${message}"</p>
                              </td>
                            </tr>
                          </table>
                        </td>
                      </tr>
                      `
                          : ""
                      }
                    </table>
                  </td>
                </tr>
              </table>

              <!-- CTA Button -->
              <table role="presentation" style="width:100%; border-collapse:collapse; margin:32px 0 24px;">
                <tr>
                  <td align="center">
                    <table role="presentation" style="border-collapse:collapse;">
                      <tr>
                        <td style="border-radius:8px; background:linear-gradient(135deg, #3b82f6 0%, #2563eb 100%); box-shadow:0 4px 6px -1px rgba(59,130,246,0.4);">
                          <a href="${redirectUrl}" target="_blank"
                            style="display:inline-block; padding:14px 32px; color:#ffffff; text-decoration:none; font-size:16px; font-weight:600; letter-spacing:0.3px;">
                            Review Request
                          </a>
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>
              </table>

              <!-- Timestamp -->
              <p style="margin:24px 0 0; font-size:13px; color:#9ca3af; text-align:center;">
                Request received: ${timestamp}
              </p>
  `.trim();

  return renderBaseEmailLayout({
    preheaderText: `New enterprise inquiry from ${companyName} - ${contactName} (${customerRequestId})`,
    headerIcon: "",
    headerTitle: "New Enterprise Request Received",
    headerSubtitle: "Requires immediate attention",
    content,
    footerText: "SynergySign Admin Portal",
    footerSubtext: `© ${new Date().getFullYear()} Synergy Technologies LLC. All rights reserved.`,
  });
}
