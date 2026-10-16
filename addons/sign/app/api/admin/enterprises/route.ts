import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { stripe, STRIPE_PRICING, ENTERPRISE_PRICING } from '@/lib/stripe';
import { generateInvitationToken } from '@/lib/invitation-tokens';
import { sendEmail } from '@/lib/email';
import { renderEnterpriseRequestApproved } from '@/lib/email-templates/enterprise-request-approved';

export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);

    if (!session || session.user.role !== 'ADMIN') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    console.log('Enterprise creation request body:', JSON.stringify(body, null, 2));
    const { 
      name, 
      domain, 
      contactName, 
      contactEmail, 
      customPricing, 
      notes,
      requestId, // Optional: Link to an enterprise request
      stripeCustomerId, // Optional: Use existing Stripe customer
      priceId, // Optional: Stripe price ID for the subscription
      licenses, // Number of licenses/seats
    } = body;

    // Validate required fields
    if (!name || !name.trim()) {
      return NextResponse.json(
        { error: 'Enterprise name is required' },
        { status: 400 }
      );
    }

    if (!contactEmail || !contactEmail.trim()) {
      return NextResponse.json(
        { error: 'Contact email is required' },
        { status: 400 }
      );
    }

    // Check if domain already exists (if domain is provided)
    if (domain) {
      const existing = await prisma.enterpriseAccount.findFirst({
        where: { domain },
      });

      if (existing) {
        return NextResponse.json(
          { error: 'An enterprise with this domain already exists' },
          { status: 400 }
        );
      }
    }

    if (customPricing !== null && customPricing !== undefined && customPricing !== '') {
      const pricingValue = typeof customPricing === 'string' ? parseFloat(customPricing) : customPricing;
      if (isNaN(pricingValue) || pricingValue < 0) {
        return NextResponse.json(
          { error: 'Custom pricing must be a valid number greater than or equal to 0' },
          { status: 400 }
        );
      }
    }

    // Check if contact user exists
    const contactUser = await prisma.user.findFirst({
      where: { email: contactEmail.toLowerCase() },
    });

    const userExists = !!contactUser;

    let finalStripeCustomerId = stripeCustomerId;
    let stripeSubscriptionId: string | undefined;

    // If we have a requestId, get the Stripe customer from the request
    if (requestId && !stripeCustomerId) {
      const enterpriseRequest = await prisma.enterpriseRequests.findUnique({
        where: { id: requestId },
      }) as { stripeCustomerId?: string | null } | null;

      if (enterpriseRequest?.stripeCustomerId) {
        finalStripeCustomerId = enterpriseRequest.stripeCustomerId;
      }
    }

    // Create the enterprise account first
    console.log('Creating enterprise with data:', {
      name,
      domain,
      contactName: contactName || "N/A",
      contactEmail: contactEmail.toLowerCase(),
      userExists,
    });
    
    let enterprise;
    try {
      enterprise = await prisma.enterpriseAccount.create({
        data: {
          name,
          domain,
          contactName: contactName || "N/A",
          contactEmail: contactEmail.toLowerCase(),
          customPricing: customPricing ? String(customPricing) : null,
          notes,
          currentUserCount: userExists ? 1 : 0,
          userLimit: licenses || 25,
          contractStartDate: new Date(),
          contractEndDate: new Date(new Date().setFullYear(new Date().getFullYear() + 1)),
        },
      });
      console.log('Enterprise created successfully:', enterprise.id);
    } catch (dbError: any) {
      console.error('Database error creating enterprise:', dbError.message);
      throw new Error(`Failed to create enterprise in database: ${dbError.message}`);
    }

    let passwordSetupToken: string | null = null;
    let passwordSetupUrl: string | undefined;

    if (!userExists) {
      // User doesn't exist - create invitation for password setup
      const expiresAt = new Date();
      expiresAt.setDate(expiresAt.getDate() + 7);

      passwordSetupToken = generateInvitationToken();

      // Check if invitation already exists
      const existingInvitation = await prisma.enterpriseInvitation.findFirst({
        where: {
          email: contactEmail.toLowerCase(),
          enterpriseId: enterprise.id,
        },
        orderBy: {
          createdAt: 'desc',
        },
      });

      if (existingInvitation) {
        // Update existing invitation
        await prisma.enterpriseInvitation.update({
          where: { id: existingInvitation.id },
          data: {
            token: passwordSetupToken,
            expiresAt,
            usedAt: null,
            userId: null,
            invitedBy: session.user.id,
          },
        });
      } else {
        // Create new invitation
        await prisma.enterpriseInvitation.create({
          data: {
            token: passwordSetupToken,
            email: contactEmail.toLowerCase(),
            enterpriseId: enterprise.id,
            invitedBy: session.user.id,
            expiresAt,
          },
        });
      }

      passwordSetupUrl = `${process.env.NEXTAUTH_URL || "http://localhost:3000"}/enterprise/setup-password?token=${passwordSetupToken}`;
    } else {
      // User exists - proceed with linking and subscription creation
      
      // Create Stripe subscription for enterprise (yearly billing)
      // Use provided priceId or get the default enterprise annual price
      const enterprisePriceId = priceId || STRIPE_PRICING.ENTERPRISE.annual;

      if (finalStripeCustomerId && enterprisePriceId) {
        try {
          // Ensure minimum licenses
          const seatCount = Math.max(licenses || ENTERPRISE_PRICING.MIN_SEATS, ENTERPRISE_PRICING.MIN_SEATS);

          const subscription = await stripe.subscriptions.create({
            customer: finalStripeCustomerId,
            items: [
              {
                price: enterprisePriceId,
                quantity: seatCount,
              },
            ],
            metadata: {
              userId: contactUser.id,
              enterpriseName: name,
              domain: domain || "",
              seats: seatCount.toString(),
            },
            // Don't charge immediately - will be billed at period end
            proration_behavior: "none",
          });

          stripeSubscriptionId = subscription.id;
          console.log(`Created enterprise subscription: ${subscription.id} for ${seatCount} seats`);
        } catch (stripeError: any) {
          console.error("Stripe subscription creation failed:", stripeError);
          return NextResponse.json(
            { error: `Failed to create Stripe subscription: ${stripeError.message}` },
            { status: 400 }
          );
        }
      }

      // Create or update subscription record
      await prisma.subscription.upsert({
        where: { userId: contactUser.id },
        create: {
          userId: contactUser.id,
          tier: 'ENTERPRISE',
          status: 'ACTIVE',
          stripeSubscriptionId: stripeSubscriptionId || null,
          currentPeriodStart: new Date(),
          currentPeriodEnd: new Date(new Date().setFullYear(new Date().getFullYear() + 1)),
        },
        update: {
          tier: 'ENTERPRISE',
          status: 'ACTIVE',
          stripeSubscriptionId: stripeSubscriptionId || null,
          currentPeriodStart: new Date(),
          currentPeriodEnd: new Date(new Date().setFullYear(new Date().getFullYear() + 1)),
        }
      });

      // Link the enterprise account to the subscription
      const subscription = await prisma.subscription.findUnique({
        where: { userId: contactUser.id },
      });

      if (subscription) {
        await prisma.enterpriseAccount.update({
          where: { id: enterprise.id },
          data: {
            subscriptionId: subscription.id,
            users: { connect: { id: contactUser.id } },
            administratorId: contactUser.id,
          },
        });
      }

      // Update the contact user's Stripe customer ID if we have one
      if (finalStripeCustomerId && !contactUser.stripeAccountId) {
        await prisma.user.update({
          where: { id: contactUser.id },
          data: { stripeAccountId: finalStripeCustomerId },
        });
      }

      await prisma.user.update({
        where: { id: contactUser.id },
        data: {
          enterpriseId: enterprise.id,
        },
      });
    }

    // Update enterprise request status if linked
    if (requestId) {
      await prisma.enterpriseRequests.update({
        where: { id: requestId },
        data: { status: 'ACTIVATED' },
      });
    }

    // Send onboarding email
    console.log('Preparing to send onboarding email to:', contactEmail.toLowerCase());
    try {
      const emailTemplate = renderEnterpriseRequestApproved({
        customerRequestId: requestId || `ENT-${enterprise.id.slice(0, 8).toUpperCase()}`,
        contactName: contactName || "there",
        companyName: name,
        teamSizeRange: licenses || 25,
        message: notes || undefined,
        passwordSetupUrl,
      });

      const emailSubject = userExists
        ? `Welcome to ${name} - Your Enterprise Account is Ready`
        : `Welcome to ${name} - Complete Your Enterprise Account Setup`;

      console.log('Sending email with subject:', emailSubject);
      await sendEmail(contactEmail.toLowerCase(), emailSubject, emailTemplate);
      console.log('Email sent successfully');
    } catch (emailError) {
      console.error("Failed to send onboarding email:", emailError);
    }

    console.log('Enterprise creation completed successfully');

    return NextResponse.json({
      ...enterprise,
      stripeSubscriptionId,
      passwordSetupUrl: passwordSetupUrl || undefined,
      userExists,
      message: userExists
        ? (stripeSubscriptionId 
            ? 'Enterprise created with active Stripe subscription. User already exists and has been linked.'
            : 'Enterprise created (manual billing). User already exists and has been linked.')
        : 'Enterprise created. Password setup email sent to contact user.',
    });
  } catch (error) {
    console.error('Error creating enterprise:', error);
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error('Detailed error:', errorMessage);
    return NextResponse.json(
      { error: `Failed to create enterprise: ${errorMessage}` },
      { status: 500 }
    );
  }
}

export async function GET(_request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);

    if (!session || session.user.role !== 'ADMIN') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const enterprises = await prisma.enterpriseAccount.findMany({
      include: {
        _count: { select: { users: true } },
      },
      orderBy: { createdAt: 'desc' },
    });

    return NextResponse.json(enterprises);
  } catch (error) {
    console.error('Error fetching enterprises:', error);
    return NextResponse.json(
      { error: 'Failed to fetch enterprises' },
      { status: 500 }
    );
  }
}
