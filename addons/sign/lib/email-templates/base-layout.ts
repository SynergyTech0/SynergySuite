/**
 * Base email layout template
 * Provides a consistent structure for all email templates
 */

export interface BaseEmailLayoutProps {
  preheaderText: string;
  headerIcon?: string;
  headerTitle: string;
  headerSubtitle: string;
  content: string;
  footerText?: string;
  footerSubtext?: string;
}

export function renderBaseEmailLayout(props: BaseEmailLayoutProps): string {
  const {
    preheaderText,
    headerIcon,
    headerTitle,
    headerSubtitle,
    content,
    footerText = "SynergySign Admin Portal",
    footerSubtext = `© ${new Date().getFullYear()} Synergy Technologies LLC. All rights reserved.`,
  } = props;

  return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="X-UA-Compatible" content="IE=edge">
  <meta name="x-apple-disable-message-reformatting">
  <title>${headerTitle}</title>
  <!--[if mso]>
  <style type="text/css">
    table {border-collapse: collapse;}
  </style>
  <![endif]-->
</head>
<body style="margin:0; padding:0; background-color:#f3f4f6; font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif; -webkit-font-smoothing:antialiased; -moz-osx-font-smoothing:grayscale;">
  
  <!-- Preheader text -->
  <div style="display:none; max-height:0; overflow:hidden; mso-hide:all;">
    ${preheaderText}
  </div>
  
  <table role="presentation" style="width:100%; border-collapse:collapse; padding:40px 0; background-color:#f3f4f6;">
    <tr>
      <td align="center" style="padding:0 16px;">
        
        <!-- Card Wrapper -->
        <table role="presentation" style="width:100%; max-width:600px; background-color:#ffffff; border-radius:12px; padding:0; border-collapse:separate; box-shadow:0 4px 6px -1px rgba(0,0,0,0.1), 0 2px 4px -1px rgba(0,0,0,0.06);">
          
          <!-- Header with gradient -->
          <tr>
            <td style="padding:40px 40px 32px; background:linear-gradient(135deg, #1e3a8a 0%, #2563eb 100%); border-radius:12px 12px 0 0;">
              <table role="presentation" style="border-collapse:collapse; width:100%;">
                <tr>
                  <td style="vertical-align:middle;">
                    <div style="font-size:26px; font-weight:700; color:#ffffff; letter-spacing:-0.3px; line-height:1.2;">${headerTitle}</div>
                    <div style="font-size:14px; color:rgba(255,255,255,0.95); margin-top:6px; font-weight:400;">${headerSubtitle}</div>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
          
          <!-- Content -->
          <tr>
            <td style="padding:40px;">
              ${content}
            </td>
          </tr>
          
          <!-- Footer -->
          <tr>
            <td style="padding:24px 32px; border-top:2px solid #f3f4f6; background-color:#fafafa; border-radius:0 0 12px 12px;">
              <table role="presentation" style="width:100%; border-collapse:collapse;">
                <tr>
                  <td align="center">
                    <p style="margin:0 0 4px; font-size:14px; color:#6b7280;">
                      <strong style="color:#111827;">${footerText}</strong>
                    </p>
                    <p style="margin:0; font-size:12px; color:#9ca3af;">
                      ${footerSubtext}
                    </p>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
        </table>
        
        <!-- Spacer -->
        <table role="presentation" style="width:100%; max-width:600px; margin-top:20px;">
          <tr>
            <td align="center">
              <p style="margin:0; font-size:12px; color:#9ca3af;">
                This is an automated notification. Please do not reply to this email.
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>
  `.trim();
}
