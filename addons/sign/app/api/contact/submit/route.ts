import { NextRequest, NextResponse } from 'next/server';
import { sendEmail } from '@/lib/email';
import {
  renderQuestionEmail,
  renderAssistanceEmail,
  renderSuggestionEmail,
  renderDemoEmail,
} from '@/lib/email-templates/contact-inquiry';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();

    // Validate required fields
    const { name, email, inquiryType } = body;

    if (!name || !email || !inquiryType) {
      return NextResponse.json(
        { error: 'Name, email, and inquiry type are required.' },
        { status: 400 }
      );
    }

    // Validate email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return NextResponse.json(
        { error: 'Invalid email address.' },
        { status: 400 }
      );
    }

    // Validate inquiry type
    const validInquiryTypes = ['question', 'assistance', 'suggestion', 'demo'];
    if (!validInquiryTypes.includes(inquiryType)) {
      return NextResponse.json(
        { error: 'Invalid inquiry type.' },
        { status: 400 }
      );
    }

    // Simulate processing delay
    await new Promise((resolve) => setTimeout(resolve, 1000));

    // Generate submission ID and timestamp
    const submissionId = `CONTACT-${Date.now()}-${Math.random().toString(36).substring(7)}`;
    const timestamp = new Date().toLocaleString('en-US', {
      timeZone: 'America/New_York',
      dateStyle: 'long',
      timeStyle: 'short',
    });

    // Log the submission (in production, this would be saved to database or sent via email)
    console.log('Contact form submission received:', {
      timestamp,
      submissionId,
      ...body,
    });

    // Prepare email data
    const emailData = {
      ...body,
      submissionId,
      timestamp,
    };

    // Send email notification based on inquiry type
    try {
      let emailHtml = '';
      let emailSubject = '';

      switch (inquiryType) {
        case 'question':
          emailHtml = renderQuestionEmail(emailData);
          emailSubject = `New Question: ${body.subject || 'General Inquiry'}`;
          break;
        case 'assistance':
          emailHtml = renderAssistanceEmail(emailData);
          emailSubject = `🆘 Assistance Required: ${body.subject || 'Technical Support'}`;
          break;
        case 'suggestion':
          emailHtml = renderSuggestionEmail(emailData);
          emailSubject = `💡 New Suggestion: ${body.subject || 'Feature Request'}`;
          break;
        case 'demo':
          emailHtml = renderDemoEmail(emailData);
          emailSubject = `🎯 Demo Request: ${body.companyName || name}`;
          break;
      }

      // Send to admin/support email
      const adminEmail = process.env.REPLY_EMAIL || process.env.GOOGLE_USER_EMAIL;
      
      if (adminEmail && emailHtml) {
        await sendEmail(adminEmail, emailSubject, emailHtml);
        console.log(`Email notification sent to ${adminEmail}`);
      } else {
        console.warn('Admin email not configured or email template not generated');
      }
    } catch (emailError) {
      console.error('Failed to send email notification:', emailError);
      // Don't fail the request if email fails, just log it
    }

    // Return success response
    return NextResponse.json(
      {
        success: true,
        message: 'Your message has been received. We will contact you soon.',
        submissionId,
      },
      { status: 200 }
    );
  } catch (error) {
    console.error('Error processing contact form:', error);
    return NextResponse.json(
      { error: 'An error occurred while processing your request.' },
      { status: 500 }
    );
  }
}
