import { renderBaseEmailLayout } from './base-layout';

interface ContactInquiryData {
  name: string;
  email: string;
  subject?: string;
  message?: string;
  phoneNumber?: string;
  currentIssue?: string;
  featureRequest?: string;
  companyName?: string;
  companySize?: string;
  preferredDate?: string;
  preferredTime?: string;
  submissionId: string;
  timestamp: string;
}

/**
 * Email template for general questions
 */
export function renderQuestionEmail(data: ContactInquiryData): string {
  const content = `
    <p style="margin:0 0 16px; font-size:15px; color:#374151; line-height:1.6;">
      A new general question has been submitted through the contact form.
    </p>
    
    <div style="background-color:#f9fafb; border-left:4px solid #3b82f6; padding:16px 20px; margin:24px 0; border-radius:6px;">
      <p style="margin:0 0 12px; font-size:13px; color:#6b7280; text-transform:uppercase; font-weight:600; letter-spacing:0.5px;">
        Inquiry Details
      </p>
      
      <table role="presentation" style="width:100%; border-collapse:collapse;">
        <tr>
          <td style="padding:8px 0; vertical-align:top;">
            <span style="font-size:14px; color:#6b7280; display:inline-block; min-width:120px;">Name:</span>
            <span style="font-size:14px; color:#111827; font-weight:500;">${data.name}</span>
          </td>
        </tr>
        <tr>
          <td style="padding:8px 0; vertical-align:top;">
            <span style="font-size:14px; color:#6b7280; display:inline-block; min-width:120px;">Email:</span>
            <a href="mailto:${data.email}" style="font-size:14px; color:#2563eb; text-decoration:none;">${data.email}</a>
          </td>
        </tr>
        <tr>
          <td style="padding:8px 0; vertical-align:top;">
            <span style="font-size:14px; color:#6b7280; display:inline-block; min-width:120px;">Subject:</span>
            <span style="font-size:14px; color:#111827; font-weight:500;">${data.subject || 'N/A'}</span>
          </td>
        </tr>
      </table>
    </div>
    
    ${data.message ? `
    <div style="margin:24px 0;">
      <p style="margin:0 0 8px; font-size:13px; color:#6b7280; text-transform:uppercase; font-weight:600; letter-spacing:0.5px;">
        Question Details
      </p>
      <div style="background-color:#ffffff; border:1px solid #e5e7eb; padding:16px; border-radius:6px;">
        <p style="margin:0; font-size:14px; color:#374151; line-height:1.6; white-space:pre-wrap;">${data.message}</p>
      </div>
    </div>
    ` : ''}
    
    <div style="margin:32px 0 0; padding:16px 0; border-top:1px solid #e5e7eb;">
      <p style="margin:0 0 4px; font-size:12px; color:#9ca3af;">
        Submission ID: <span style="color:#6b7280; font-family:monospace;">${data.submissionId}</span>
      </p>
      <p style="margin:0; font-size:12px; color:#9ca3af;">
        Submitted: ${data.timestamp}
      </p>
    </div>
  `;

  return renderBaseEmailLayout({
    preheaderText: `New question from ${data.name}`,
    headerIcon: '❓',
    headerTitle: 'New Question Received',
    headerSubtitle: 'Contact Form Submission',
    content,
  });
}

/**
 * Email template for assistance requests
 */
export function renderAssistanceEmail(data: ContactInquiryData): string {
  const content = `
    <p style="margin:0 0 16px; font-size:15px; color:#374151; line-height:1.6;">
      A new technical assistance request has been submitted.
    </p>
    
    <div style="background-color:#fef2f2; border-left:4px solid #ef4444; padding:16px 20px; margin:24px 0; border-radius:6px;">
      <p style="margin:0 0 12px; font-size:13px; color:#991b1b; text-transform:uppercase; font-weight:600; letter-spacing:0.5px;">
        ⚠️ Assistance Required
      </p>
      
      <table role="presentation" style="width:100%; border-collapse:collapse;">
        <tr>
          <td style="padding:8px 0; vertical-align:top;">
            <span style="font-size:14px; color:#6b7280; display:inline-block; min-width:120px;">Name:</span>
            <span style="font-size:14px; color:#111827; font-weight:500;">${data.name}</span>
          </td>
        </tr>
        <tr>
          <td style="padding:8px 0; vertical-align:top;">
            <span style="font-size:14px; color:#6b7280; display:inline-block; min-width:120px;">Email:</span>
            <a href="mailto:${data.email}" style="font-size:14px; color:#2563eb; text-decoration:none;">${data.email}</a>
          </td>
        </tr>
        ${data.phoneNumber ? `
        <tr>
          <td style="padding:8px 0; vertical-align:top;">
            <span style="font-size:14px; color:#6b7280; display:inline-block; min-width:120px;">Phone:</span>
            <a href="tel:${data.phoneNumber}" style="font-size:14px; color:#2563eb; text-decoration:none;">${data.phoneNumber}</a>
          </td>
        </tr>
        ` : ''}
        <tr>
          <td style="padding:8px 0; vertical-align:top;">
            <span style="font-size:14px; color:#6b7280; display:inline-block; min-width:120px;">Issue:</span>
            <span style="font-size:14px; color:#111827; font-weight:500;">${data.subject || 'N/A'}</span>
          </td>
        </tr>
      </table>
    </div>
    
    ${data.currentIssue ? `
    <div style="margin:24px 0;">
      <p style="margin:0 0 8px; font-size:13px; color:#6b7280; text-transform:uppercase; font-weight:600; letter-spacing:0.5px;">
        Issue Details
      </p>
      <div style="background-color:#ffffff; border:1px solid #e5e7eb; padding:16px; border-radius:6px;">
        <p style="margin:0; font-size:14px; color:#374151; line-height:1.6; white-space:pre-wrap;">${data.currentIssue}</p>
      </div>
    </div>
    ` : ''}
    
    ${data.message ? `
    <div style="margin:24px 0;">
      <p style="margin:0 0 8px; font-size:13px; color:#6b7280; text-transform:uppercase; font-weight:600; letter-spacing:0.5px;">
        Additional Details
      </p>
      <div style="background-color:#ffffff; border:1px solid #e5e7eb; padding:16px; border-radius:6px;">
        <p style="margin:0; font-size:14px; color:#374151; line-height:1.6; white-space:pre-wrap;">${data.message}</p>
      </div>
    </div>
    ` : ''}
    
    <div style="margin:32px 0 0; padding:16px 0; border-top:1px solid #e5e7eb;">
      <p style="margin:0 0 4px; font-size:12px; color:#9ca3af;">
        Submission ID: <span style="color:#6b7280; font-family:monospace;">${data.submissionId}</span>
      </p>
      <p style="margin:0; font-size:12px; color:#9ca3af;">
        Submitted: ${data.timestamp}
      </p>
    </div>
  `;

  return renderBaseEmailLayout({
    preheaderText: `Assistance request from ${data.name}`,
    headerIcon: '🆘',
    headerTitle: 'Technical Assistance Request',
    headerSubtitle: 'Priority Support Needed',
    content,
  });
}

/**
 * Email template for suggestions/feature requests
 */
export function renderSuggestionEmail(data: ContactInquiryData): string {
  const content = `
    <p style="margin:0 0 16px; font-size:15px; color:#374151; line-height:1.6;">
      A new suggestion or feature request has been submitted.
    </p>
    
    <div style="background-color:#f0fdf4; border-left:4px solid #10b981; padding:16px 20px; margin:24px 0; border-radius:6px;">
      <p style="margin:0 0 12px; font-size:13px; color:#065f46; text-transform:uppercase; font-weight:600; letter-spacing:0.5px;">
        💡 Product Feedback
      </p>
      
      <table role="presentation" style="width:100%; border-collapse:collapse;">
        <tr>
          <td style="padding:8px 0; vertical-align:top;">
            <span style="font-size:14px; color:#6b7280; display:inline-block; min-width:120px;">Name:</span>
            <span style="font-size:14px; color:#111827; font-weight:500;">${data.name}</span>
          </td>
        </tr>
        <tr>
          <td style="padding:8px 0; vertical-align:top;">
            <span style="font-size:14px; color:#6b7280; display:inline-block; min-width:120px;">Email:</span>
            <a href="mailto:${data.email}" style="font-size:14px; color:#2563eb; text-decoration:none;">${data.email}</a>
          </td>
        </tr>
        <tr>
          <td style="padding:8px 0; vertical-align:top;">
            <span style="font-size:14px; color:#6b7280; display:inline-block; min-width:120px;">Title:</span>
            <span style="font-size:14px; color:#111827; font-weight:500;">${data.subject || 'N/A'}</span>
          </td>
        </tr>
      </table>
    </div>
    
    ${data.featureRequest ? `
    <div style="margin:24px 0;">
      <p style="margin:0 0 8px; font-size:13px; color:#6b7280; text-transform:uppercase; font-weight:600; letter-spacing:0.5px;">
        Suggestion Details
      </p>
      <div style="background-color:#ffffff; border:1px solid #e5e7eb; padding:16px; border-radius:6px;">
        <p style="margin:0; font-size:14px; color:#374151; line-height:1.6; white-space:pre-wrap;">${data.featureRequest}</p>
      </div>
    </div>
    ` : ''}
    
    ${data.message ? `
    <div style="margin:24px 0;">
      <p style="margin:0 0 8px; font-size:13px; color:#6b7280; text-transform:uppercase; font-weight:600; letter-spacing:0.5px;">
        Additional Information
      </p>
      <div style="background-color:#ffffff; border:1px solid #e5e7eb; padding:16px; border-radius:6px;">
        <p style="margin:0; font-size:14px; color:#374151; line-height:1.6; white-space:pre-wrap;">${data.message}</p>
      </div>
    </div>
    ` : ''}
    
    <div style="margin:32px 0 0; padding:16px 0; border-top:1px solid #e5e7eb;">
      <p style="margin:0 0 4px; font-size:12px; color:#9ca3af;">
        Submission ID: <span style="color:#6b7280; font-family:monospace;">${data.submissionId}</span>
      </p>
      <p style="margin:0; font-size:12px; color:#9ca3af;">
        Submitted: ${data.timestamp}
      </p>
    </div>
  `;

  return renderBaseEmailLayout({
    preheaderText: `New suggestion from ${data.name}`,
    headerIcon: '💡',
    headerTitle: 'New Suggestion Received',
    headerSubtitle: 'Feature Request & Feedback',
    content,
  });
}

/**
 * Email template for demo requests
 */
export function renderDemoEmail(data: ContactInquiryData): string {
  const formatTime = (time?: string) => {
    if (!time) return 'Not specified';
    switch(time) {
      case 'morning': return 'Morning (9AM - 12PM)';
      case 'afternoon': return 'Afternoon (12PM - 5PM)';
      case 'evening': return 'Evening (5PM - 8PM)';
      default: return time;
    }
  };

  const content = `
    <p style="margin:0 0 16px; font-size:15px; color:#374151; line-height:1.6;">
      A new demo request has been submitted. Please schedule accordingly.
    </p>
    
    <div style="background-color:#fef3c7; border-left:4px solid #f59e0b; padding:16px 20px; margin:24px 0; border-radius:6px;">
      <p style="margin:0 0 12px; font-size:13px; color:#92400e; text-transform:uppercase; font-weight:600; letter-spacing:0.5px;">
        🎯 Demo Scheduling Request
      </p>
      
      <table role="presentation" style="width:100%; border-collapse:collapse;">
        <tr>
          <td style="padding:8px 0; vertical-align:top;">
            <span style="font-size:14px; color:#6b7280; display:inline-block; min-width:140px;">Name:</span>
            <span style="font-size:14px; color:#111827; font-weight:500;">${data.name}</span>
          </td>
        </tr>
        <tr>
          <td style="padding:8px 0; vertical-align:top;">
            <span style="font-size:14px; color:#6b7280; display:inline-block; min-width:140px;">Email:</span>
            <a href="mailto:${data.email}" style="font-size:14px; color:#2563eb; text-decoration:none;">${data.email}</a>
          </td>
        </tr>
        <tr>
          <td style="padding:8px 0; vertical-align:top;">
            <span style="font-size:14px; color:#6b7280; display:inline-block; min-width:140px;">Phone:</span>
            <a href="tel:${data.phoneNumber}" style="font-size:14px; color:#2563eb; text-decoration:none;">${data.phoneNumber || 'N/A'}</a>
          </td>
        </tr>
        <tr>
          <td style="padding:8px 0; vertical-align:top;">
            <span style="font-size:14px; color:#6b7280; display:inline-block; min-width:140px;">Company:</span>
            <span style="font-size:14px; color:#111827; font-weight:500;">${data.companyName || 'N/A'}</span>
          </td>
        </tr>
        <tr>
          <td style="padding:8px 0; vertical-align:top;">
            <span style="font-size:14px; color:#6b7280; display:inline-block; min-width:140px;">Company Size:</span>
            <span style="font-size:14px; color:#111827; font-weight:500;">${data.companySize || 'N/A'}</span>
          </td>
        </tr>
      </table>
    </div>
    
    <div style="background-color:#eff6ff; border:1px solid #93c5fd; padding:16px 20px; margin:24px 0; border-radius:6px;">
      <p style="margin:0 0 12px; font-size:13px; color:#1e40af; text-transform:uppercase; font-weight:600; letter-spacing:0.5px;">
        📅 Preferred Schedule
      </p>
      
      <table role="presentation" style="width:100%; border-collapse:collapse;">
        <tr>
          <td style="padding:8px 0; vertical-align:top;">
            <span style="font-size:14px; color:#6b7280; display:inline-block; min-width:140px;">Preferred Date:</span>
            <span style="font-size:14px; color:#111827; font-weight:500;">${data.preferredDate || 'Not specified'}</span>
          </td>
        </tr>
        <tr>
          <td style="padding:8px 0; vertical-align:top;">
            <span style="font-size:14px; color:#6b7280; display:inline-block; min-width:140px;">Preferred Time:</span>
            <span style="font-size:14px; color:#111827; font-weight:500;">${formatTime(data.preferredTime)}</span>
          </td>
        </tr>
      </table>
    </div>
    
    ${data.message ? `
    <div style="margin:24px 0;">
      <p style="margin:0 0 8px; font-size:13px; color:#6b7280; text-transform:uppercase; font-weight:600; letter-spacing:0.5px;">
        Additional Requirements
      </p>
      <div style="background-color:#ffffff; border:1px solid #e5e7eb; padding:16px; border-radius:6px;">
        <p style="margin:0; font-size:14px; color:#374151; line-height:1.6; white-space:pre-wrap;">${data.message}</p>
      </div>
    </div>
    ` : ''}
    
    <div style="margin:32px 0 0; padding:16px 0; border-top:1px solid #e5e7eb;">
      <p style="margin:0 0 4px; font-size:12px; color:#9ca3af;">
        Submission ID: <span style="color:#6b7280; font-family:monospace;">${data.submissionId}</span>
      </p>
      <p style="margin:0; font-size:12px; color:#9ca3af;">
        Submitted: ${data.timestamp}
      </p>
    </div>
  `;

  return renderBaseEmailLayout({
    preheaderText: `Demo request from ${data.companyName || data.name}`,
    headerIcon: '🎯',
    headerTitle: 'New Demo Request',
    headerSubtitle: 'Schedule Demo Session',
    content,
  });
}
