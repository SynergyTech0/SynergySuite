import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getServerSession } from "@/lib/auth";
import { NextRequest, NextResponse } from "next/server";
import { stripe } from "@/lib/stripe";

export async function POST(request: NextRequest) {
    const session = await getServerSession(authOptions);
    
    if (!session || session.user.role !== 'ADMIN') {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { requestId } = await request.json();
    const enterpriseRequest = await prisma.enterpriseRequests.findUnique({
        where: { id: requestId },
    });

    if (!enterpriseRequest) {
        return NextResponse.json(
        { error: 'Enterprise request not found' },
        { status: 404 }
        );
    }

    // Get or validate the contact user
    const contactUser = await prisma.user.findFirst({
        where: { email: enterpriseRequest.contactEmail },
    });

    if (!contactUser) {
        return NextResponse.json(
        { error: 'Contact user not found. User must have an account before creating enterprise.' },
        { status: 400 }
        );
    }

    if (!enterpriseRequest.stripeCustomerId) {
        return NextResponse.json(
            { error: 'Stripe customer ID not found in the enterprise request.' },
            { status: 400 }
        );
    }

    // Validate team size
    const teamSize = parseInt(enterpriseRequest.teamSize?.toString().trim().replace(/\D/g, ''), 10) || 1;
    if (teamSize < 25) {
        return NextResponse.json(
            { error: 'Invalid team size in enterprise request.' },
            { status: 400 }
        );
    }

    // For metered billing, create subscription without quantity
    const subscription = await stripe.subscriptions.create({
        customer: enterpriseRequest.stripeCustomerId,
        items: [{ price: process.env.STRIPE_ENTERPRISE_PRICE_ID }],
        expand: ['latest_invoice.payment_intent'],
    });

    if (!subscription.id) {
        return NextResponse.json(
            { error: 'Failed to create Stripe subscription.' },
            { status: 500 }
        );
    }

    // Report initial usage based on team size
    await stripe.billing.meterEvents.create({
        event_name: 'user_seats',
        payload: {
            stripe_customer_id: enterpriseRequest.stripeCustomerId,
            value: teamSize.toString(),
        },
        timestamp: Math.floor(Date.now() / 1000),
    });

    // Update subscription in the database
    const localSubscription = await prisma.subscription.upsert({
        where: { userId: contactUser.id },
        update: {
            stripeSubscriptionId: subscription.id,
            tier: "ENTERPRISE",
            status: "ACTIVE",
            stripePriceId: process.env.STRIPE_ENTERPRISE_PRICE_ID,
            currentPeriodStart: new Date(subscription.start_date * 1000),
            currentPeriodEnd: new Date(subscription.items.data[0].current_period_end * 1000),
            cancelAtPeriodEnd: subscription.cancel_at_period_end,
        },
        create: {
            userId: contactUser.id,
            stripeSubscriptionId: subscription.id,
            tier: "ENTERPRISE",
            status: "ACTIVE",
            stripePriceId: process.env.STRIPE_ENTERPRISE_PRICE_ID,
            currentPeriodStart: new Date(subscription.start_date * 1000),
            currentPeriodEnd: new Date(subscription.items.data[0].current_period_end * 1000),
            cancelAtPeriodEnd: subscription.cancel_at_period_end,
        },
    });

    await prisma.user.update({
        where: { id: contactUser.id },
        data: {
            stripeAccountId: enterpriseRequest.stripeCustomerId,
        },
    });

    // TODO: Should filter domain from contact email to prevent things like "gmail.com"
    await prisma.enterpriseAccount.create({
        data: {
            name: enterpriseRequest.companyName,
            domain: enterpriseRequest.contactEmail.split('@')[1],
            contactName: enterpriseRequest.contactName || "N/A", // ✅ corrected spelling
            contactEmail: enterpriseRequest.contactEmail,
            notes: enterpriseRequest.message,
            currentUserCount: 1,
            administratorId: contactUser.id,
            subscriptionId: localSubscription.id,
            userLimit: teamSize,
            isActive: true,
        }
    });

    // Update the enterprise request status to ACTIVATED
    await prisma.enterpriseRequests.update({
        where: { id: requestId },
        data: { 
            status: 'ACTIVATED',
            updatedAt: new Date(),
        },
    });

    return NextResponse.json({ message: 'Enterprise request activated successfully' });
}