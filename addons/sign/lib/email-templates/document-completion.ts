/**
 * Email template for document completion notification
 * Sent to all signers when document signing is complete
 */

import { renderBaseEmailLayout } from "./base-layout";

export interface SignerInfo {
  name: string;
  email: string;
  signedAt: Date;
}

export interface DocumentCompletionData {
  recipientName: string;
  documentTitle: string;
  signers: SignerInfo[];
  documentHash: string;
  completedAt: Date;
}

export function renderDocumentCompletion(data: DocumentCompletionData): string {
  const { recipientName, documentTitle, signers, documentHash, completedAt } =
    data;

  // Build content HTML
  const content = `
              <div style="padding:8px 0;">
                <p style="margin:0 0 28px; font-size:16px; line-height:1.8; color:#374151;">
                  Dear <strong style="color:#111827;">${recipientName}</strong>,
                </p>

                <p style="margin:0 0 28px; font-size:16px; line-height:1.8; color:#374151;">
                  Great news! The document "<strong style="color:#111827;">${documentTitle}</strong>" has been fully signed by all parties.
                </p>
              </div>

              <!-- Success Banner -->
              <table role="presentation" style="width:100%; border-collapse:collapse; margin:32px 0;">
                <tr>
                  <td style="background-color:#ecfdf5; border-left:4px solid #10b981; padding:20px 24px; border-radius:8px; text-align:center;">
                    <p style="margin:0; font-size:18px; font-weight:700; color:#065f46;">
                      Document Signing Complete
                    </p>
                    <p style="margin:8px 0 0; font-size:14px; color:#047857;">
                      Completed on ${completedAt.toLocaleDateString("en-US", {
                        weekday: "long",
                        year: "numeric",
                        month: "long",
                        day: "numeric",
                      })}
                    </p>
                  </td>
                </tr>
              </table>

              <!-- Signers List -->
              <table role="presentation" style="width:100%; border-collapse:collapse; margin:36px 0;">
                <tr>
                  <td style="background-color:#f9fafb; border:2px solid #e5e7eb; border-radius:10px; padding:0; overflow:hidden;">

                    <!-- Section Header -->
                    <table role="presentation" style="width:100%; border-collapse:collapse;">
                      <tr>
                        <td style="padding:20px 24px; background-color:#f3f4f6; border-bottom:2px solid #e5e7eb;">
                          <h2 style="margin:0; font-size:18px; font-weight:700; color:#111827; letter-spacing:-0.3px;">Signers</h2>
                        </td>
                      </tr>
                    </table>

                    <!-- Signers Rows -->
                    <table role="presentation" style="width:100%; border-collapse:collapse;">
                      ${signers
                        .map(
                          (signer, index) => `
                      <tr>
                        <td style="padding:18px 24px; ${index % 2 === 0 ? "" : "background-color:#fafafa;"}; ${index > 0 ? "border-top:1px solid #e5e7eb;" : ""}">
                          <table role="presentation" style="width:100%; border-collapse:collapse;">
                            <tr>
                              <td style="vertical-align:middle;">
                                <p style="margin:0; font-size:15px; font-weight:600; color:#111827;">${
                                  signer.name
                                }</p>
                                <p style="margin:2px 0 0; font-size:13px; color:#6b7280;">${
                                  signer.email
                                }</p>
                              </td>
                              <td style="text-align:right; vertical-align:middle;">
                                <p style="margin:0; font-size:13px; color:#6b7280;">
                                  Signed ${signer.signedAt.toLocaleDateString(
                                    "en-US",
                                    {
                                      month: "short",
                                      day: "numeric",
                                      year: "numeric",
                                    },
                                  )}
                                </p>
                              </td>
                            </tr>
                          </table>
                        </td>
                      </tr>
                      `,
                        )
                        .join("")}
                    </table>
                  </td>
                </tr>
              </table>

              <!-- Document Integrity Section -->
              <table role="presentation" style="width:100%; border-collapse:collapse; margin:36px 0;">
                <tr>
                  <td style="background-color:#f9fafb; border:2px solid #e5e7eb; border-radius:10px; padding:0; overflow:hidden;">

                    <!-- Section Header -->
                    <table role="presentation" style="width:100%; border-collapse:collapse;">
                      <tr>
                        <td style="padding:20px 24px; background-color:#f3f4f6; border-bottom:2px solid #e5e7eb;">
                          <h2 style="margin:0; font-size:18px; font-weight:700; color:#111827; letter-spacing:-0.3px;">Document Integrity</h2>
                        </td>
                      </tr>
                    </table>

                    <!-- Hash Display -->
                    <table role="presentation" style="width:100%; border-collapse:collapse;">
                      <tr>
                        <td style="padding:24px;">
                          <p style="margin:0 0 12px; font-size:14px; font-weight:600; color:#374151;">
                            SHA-256 Hash:
                          </p>
                          <div style="background-color:#f3f4f6; border:2px solid #e5e7eb; border-radius:8px; padding:16px; font-family:monospace; font-size:12px; color:#111827; word-break:break-all; line-height:1.6;">
                            ${documentHash}
                          </div>
                          <p style="margin:16px 0 0; font-size:13px; color:#6b7280; line-height:1.6;">
                            This cryptographic hash proves the document has not been altered since signing. You can verify the document's authenticity by calculating its SHA-256 hash and comparing it with the value above.
                          </p>
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>
              </table>

              <!-- Attachments Notice -->
              <div style="padding:8px 0;">
                <table role="presentation" style="width:100%; border-collapse:collapse; margin:36px 0;">
                  <tr>
                    <td style="background-color:#f0f9ff; border-left:4px solid #3b82f6; padding:18px 22px; border-radius:8px;">
                      <table role="presentation" style="width:100%; border-collapse:collapse;">
                        <tr>
                          <td style="padding-left:12px; vertical-align:top;">
                            <p style="margin:0; font-size:14px; font-weight:600; color:#1e40af;">
                              Attached Documents
                            </p>
                            <p style="margin:8px 0 0; font-size:13px; color:#1e3a8a; line-height:1.7;">
                              • Signed PDF document with all signatures<br>
                              • Certificate of Completion
                            </p>
                          </td>
                        </tr>
                      </table>
                    </td>
                  </tr>
                </table>

                <p style="margin:32px 0 0; font-size:16px; line-height:1.8; color:#374151;">
                  Please keep these documents for your records. If you have any questions, feel free to reach out to our support team.
                </p>

                <p style="margin:28px 0 0; font-size:16px; line-height:1.8; color:#374151;">
                  Thank you for using SynergySign!<br>
                  <strong style="color:#111827;">The SynergySign Team</strong>
                </p>
              </div>
  `.trim();

  return renderBaseEmailLayout({
    preheaderText: `"${documentTitle}" has been fully signed by all parties`,
    headerTitle: "Document Signed",
    headerSubtitle: "All parties have completed their signatures",
    content,
    footerText: "SynergySign",
    footerSubtext: `© ${new Date().getFullYear()} Synergy Technologies LLC. All rights reserved.`,
  });
}
