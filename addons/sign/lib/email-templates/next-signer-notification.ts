/**
 * Email template for next signer notification (sequential signing)
 * Sent to the next signer when the previous signer completes their signature
 */

import { renderBaseEmailLayout } from "./base-layout";

export interface NextSignerNotificationData {
  signerName: string;
  documentTitle: string;
  previousSignerName: string;
  signLink: string;
  signingOrder: number;
  totalSigners: number;
}

export function renderNextSignerNotification(
  data: NextSignerNotificationData
): string {
  const {
    signerName,
    documentTitle,
    previousSignerName,
    signLink,
    signingOrder,
    totalSigners,
  } = data;

  // Build content HTML
  const content = `
              <div style="padding:8px 0;">
                <p style="margin:0 0 28px; font-size:16px; line-height:1.8; color:#374151;">
                  Hi <strong style="color:#111827;">${signerName || "there"}</strong>,
                </p>

                <p style="margin:0 0 28px; font-size:16px; line-height:1.8; color:#374151;">
                  Great news! <strong style="color:#111827;">${previousSignerName}</strong> has completed their signature. It's now your turn to sign the document.
                </p>
              </div>

              <!-- Progress Indicator -->
              <table role="presentation" style="width:100%; border-collapse:collapse; margin:32px 0;">
                <tr>
                  <td style="background-color:#ecfdf5; border-left:4px solid #10b981; padding:18px 22px; border-radius:8px;">
                    <p style="margin:0; font-size:14px; font-weight:600; color:#065f46;">
                      You're next in line (Signer ${signingOrder} of ${totalSigners})
                    </p>
                    <p style="margin:8px 0 0; font-size:13px; color:#047857; line-height:1.6;">
                      The previous signer has completed their signature. Please review and sign the document to keep the process moving.
                    </p>
                  </td>
                </tr>
              </table>

              <!-- Document Details Card -->
              <table role="presentation" style="width:100%; border-collapse:collapse; margin:36px 0;">
                <tr>
                  <td style="background-color:#f9fafb; border:2px solid #e5e7eb; border-radius:10px; padding:0; overflow:hidden;">
                    
                    <!-- Section Header -->
                    <table role="presentation" style="width:100%; border-collapse:collapse;">
                      <tr>
                        <td style="padding:20px 24px; background-color:#f3f4f6; border-bottom:2px solid #e5e7eb;">
                          <h2 style="margin:0; font-size:18px; font-weight:700; color:#111827; letter-spacing:-0.3px;">Document Details</h2>
                        </td>
                      </tr>
                    </table>

                    <!-- Details Rows -->
                    <table role="presentation" style="width:100%; border-collapse:collapse;">
                      <tr>
                        <td style="padding:20px 24px;">
                          <table role="presentation" style="width:100%; border-collapse:collapse;">
                            <tr>
                              <td style="width:140px; color:#6b7280; font-size:13px; font-weight:600; text-transform:uppercase; letter-spacing:0.5px; vertical-align:top; padding-top:2px;">Document</td>
                              <td style="color:#111827; font-size:16px; font-weight:600; line-height:1.5;">${documentTitle}</td>
                            </tr>
                          </table>
                        </td>
                      </tr>
                      <tr>
                        <td style="padding:20px 24px; background-color:#fafafa; border-top:1px solid #e5e7eb;">
                          <table role="presentation" style="width:100%; border-collapse:collapse;">
                            <tr>
                              <td style="width:140px; color:#6b7280; font-size:13px; font-weight:600; text-transform:uppercase; letter-spacing:0.5px; vertical-align:top; padding-top:2px;">Previous Signer</td>
                              <td style="color:#111827; font-size:15px; font-weight:500;">${previousSignerName}</td>
                            </tr>
                          </table>
                        </td>
                      </tr>
                      <tr>
                        <td style="padding:20px 24px; border-top:1px solid #e5e7eb;">
                          <table role="presentation" style="width:100%; border-collapse:collapse;">
                            <tr>
                              <td style="width:140px; color:#6b7280; font-size:13px; font-weight:600; text-transform:uppercase; letter-spacing:0.5px; vertical-align:top; padding-top:2px;">Your Position</td>
                              <td>
                                <span style="display:inline-block; background-color:#dbeafe; color:#1e40af; padding:6px 14px; border-radius:20px; font-size:14px; font-weight:600;">
                                  Signer ${signingOrder} of ${totalSigners}
                                </span>
                              </td>
                            </tr>
                          </table>
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>
              </table>

              <!-- CTA Button -->
              <div style="padding:8px 0;">
                <table role="presentation" style="width:100%; border-collapse:collapse; margin:36px 0;">
                  <tr>
                    <td align="center">
                      <a href="${signLink}" style="display:inline-block; background:linear-gradient(135deg, #10b981 0%, #059669 100%); color:#ffffff; text-decoration:none; padding:16px 52px; border-radius:8px; font-size:16px; font-weight:600; box-shadow:0 4px 6px -1px rgba(16, 185, 129, 0.3); transition:all 0.2s;">
                        Sign Document Now
                      </a>
                    </td>
                  </tr>
                </table>

                <p style="margin:32px 0 0; font-size:14px; line-height:1.8; color:#6b7280; text-align:center;">
                  Or copy this link: <br>
                  <a href="${signLink}" style="color:#10b981; word-break:break-all; font-size:13px;">${signLink}</a>
                </p>

                <p style="margin:36px 0 0; font-size:16px; line-height:1.8; color:#374151;">
                  Thank you for your prompt attention,<br>
                  <strong style="color:#111827;">The SynergySign Team</strong>
                </p>
              </div>
  `.trim();

  return renderBaseEmailLayout({
    preheaderText: `${previousSignerName} has signed. It's your turn to sign "${documentTitle}"`,
    headerTitle: "Your Turn to Sign",
    headerSubtitle: "The previous signer has completed their signature",
    content,
    footerText: "SynergySign",
    footerSubtext: `© ${new Date().getFullYear()} Synergy Technologies LLC. All rights reserved.`,
  });
}
