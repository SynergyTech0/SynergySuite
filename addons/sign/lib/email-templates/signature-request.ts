/**
 * Email template for signature request invitation
 * Sent to signers when they are invited to sign a document
 */

import { renderBaseEmailLayout } from "./base-layout";

export interface SignatureRequestData {
  signerName: string;
  documentTitle: string;
  senderName?: string;
  signLink: string;
  isSequential?: boolean;
  isFirstSigner?: boolean;
  dueDate?: Date;
}

export function renderSignatureRequest(data: SignatureRequestData): string {
  const {
    signerName,
    documentTitle,
    senderName,
    signLink,
    isSequential = false,
    isFirstSigner = false,
    dueDate,
  } = data;

  // Build content HTML
  const content = `
              <div style="padding:8px 0;">
                <p style="margin:0 0 28px; font-size:16px; line-height:1.8; color:#374151;">
                  Hi <strong style="color:#111827;">${signerName || "there"}</strong>,
                </p>

                <p style="margin:0 0 28px; font-size:16px; line-height:1.8; color:#374151;">
                  ${senderName ? `<strong style="color:#111827;">${senderName}</strong> has requested` : "You've been asked for"} your signature on a document${senderName ? "" : " on SynergySign"}.
                </p>
              </div>

              ${
                isSequential && isFirstSigner
                  ? `
              <table role="presentation" style="width:100%; border-collapse:collapse; margin:24px 0;">
                <tr>
                  <td style="background-color:#fef3c7; border-left:4px solid #f59e0b; padding:16px 20px; border-radius:8px;">
                    <table role="presentation" style="width:100%; border-collapse:collapse;">
                      <tr>
                        <td style="width:28px; vertical-align:top; padding-top:2px;">
                          <span style="font-size:20px; font-weight:700; color:#f59e0b;">!</span>
                        </td>
                        <td style="padding-left:12px; vertical-align:top;">
                          <p style="margin:0; font-size:14px; font-weight:600; color:#92400e;">
                            You are the first signer
                          </p>
                          <p style="margin:6px 0 0; font-size:13px; color:#78350f; line-height:1.6;">
                            The next signer will be notified once you complete your signature.
                          </p>
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>
              </table>
              `
                  : ""
              }

              <!-- Document Details Card -->
              <table role="presentation" style="width:100%; border-collapse:collapse; margin:32px 0;">
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
                              <td style="width:120px; color:#6b7280; font-size:13px; font-weight:600; text-transform:uppercase; letter-spacing:0.5px; vertical-align:top; padding-top:2px;">Document</td>
                              <td style="color:#111827; font-size:16px; font-weight:600; line-height:1.5;">${documentTitle}</td>
                            </tr>
                          </table>
                        </td>
                      </tr>
                      ${
                        senderName
                          ? `
                      <tr>
                        <td style="padding:20px 24px; background-color:#fafafa; border-top:1px solid #e5e7eb;">
                          <table role="presentation" style="width:100%; border-collapse:collapse;">
                            <tr>
                              <td style="width:120px; color:#6b7280; font-size:13px; font-weight:600; text-transform:uppercase; letter-spacing:0.5px; vertical-align:top; padding-top:2px;">Sent By</td>
                              <td style="color:#111827; font-size:15px; font-weight:500;">${senderName}</td>
                            </tr>
                          </table>
                        </td>
                      </tr>
                      `
                          : ""
                      }
                      ${
                        dueDate
                          ? `
                      <tr>
                        <td style="padding:20px 24px; ${senderName ? "" : "background-color:#fafafa;"}; border-top:1px solid #e5e7eb;">
                          <table role="presentation" style="width:100%; border-collapse:collapse;">
                            <tr>
                              <td style="width:120px; color:#6b7280; font-size:13px; font-weight:600; text-transform:uppercase; letter-spacing:0.5px; vertical-align:top; padding-top:2px;">Due Date</td>
                              <td style="color:#dc2626; font-size:15px; font-weight:600;">
                                ${dueDate.toLocaleDateString("en-US", {
                                  weekday: "short",
                                  year: "numeric",
                                  month: "short",
                                  day: "numeric",
                                })}
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
              <div style="padding:8px 0;">
                <table role="presentation" style="width:100%; border-collapse:collapse; margin:36px 0;">
                  <tr>
                    <td align="center">
                      <a href="${signLink}" style="display:inline-block; background:linear-gradient(135deg, #3b82f6 0%, #2563eb 100%); color:#ffffff; text-decoration:none; padding:16px 52px; border-radius:8px; font-size:16px; font-weight:600; box-shadow:0 4px 6px -1px rgba(59, 130, 246, 0.3); transition:all 0.2s;">
                        Review & Sign Document
                      </a>
                    </td>
                  </tr>
                </table>

                <p style="margin:32px 0; font-size:14px; line-height:1.8; color:#6b7280; text-align:center;">
                  Or copy this link: <br>
                  <a href="${signLink}" style="color:#3b82f6; word-break:break-all; font-size:13px;">${signLink}</a>
                </p>

                <table role="presentation" style="width:100%; border-collapse:collapse; margin:36px 0 0;">
                  <tr>
                    <td style="background-color:#f0f9ff; border-left:4px solid #3b82f6; padding:18px 22px; border-radius:8px;">
                      <p style="margin:0; font-size:13px; color:#1e40af; line-height:1.7;">
                        <strong style="display:block; margin-bottom:8px; font-size:14px;">Secure Document Signing</strong>
                        Your signature is legally binding. Please review the document carefully before signing.
                      </p>
                    </td>
                  </tr>
                </table>

                <p style="margin:32px 0 0; font-size:16px; line-height:1.8; color:#374151;">
                  Thank you,<br>
                  <strong style="color:#111827;">The SynergySign Team</strong>
                </p>
              </div>
  `.trim();

  return renderBaseEmailLayout({
    preheaderText: `${senderName || "Someone"} has requested your signature on "${documentTitle}"`,
    headerTitle: "Signature Request",
    headerSubtitle: "A document is waiting for your signature",
    content,
    footerText: "SynergySign",
    footerSubtext: `© ${new Date().getFullYear()} Synergy Technologies LLC. All rights reserved.`,
  });
}
