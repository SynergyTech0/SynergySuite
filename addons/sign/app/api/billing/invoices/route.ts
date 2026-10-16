import { NextResponse } from "next/server";
import { getServerSession } from "@/lib/auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { stripe } from "@/lib/stripe";

export async function GET(request: Request) {
  try {
    const session = await getServerSession(authOptions);

    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Get pagination parameters from query string
    const { searchParams } = new URL(request.url);
    const limit = parseInt(searchParams.get("limit") || "1");
    const startingAfter = searchParams.get("starting_after");
    const typeFilter = searchParams.get("type"); // Filter by invoice type

    // Get user with Stripe customer ID
    const user = await prisma.user.findUnique({
      where: { id: session.user.id },
      select: { stripeAccountId: true },
    });

    if (!user) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    // If no Stripe customer ID, return empty invoice list
    if (!user.stripeAccountId) {
      return NextResponse.json({
        invoices: [],
        hasMore: false,
        nextCursor: null,
      });
    }

    // Fetch invoices from Stripe with cursor-based pagination
    // We need to fetch more invoices to account for filtering because there's no direct way to filter on Stripe's side
    const invoicesParams: any = {
      customer: user.stripeAccountId,
      limit: 100, // Fetch more to filter through
    };

    // Add starting_after cursor if provided
    if (startingAfter) {
      invoicesParams.starting_after = startingAfter;
    }

    const invoices = await stripe.invoices.list(invoicesParams);

    // Transform Stripe invoice data to a simpler format
    const formattedInvoices = invoices.data.map((invoice) => {
      // Determine invoice type based on lines
      let invoiceType = "Payment";
      if (invoice.lines.data.length > 0) {
        const description = invoice.lines.data[0].description || "";
        if (description.toLowerCase().includes("upgrade")) {
          invoiceType = "Upgrade";
        } else if (description.toLowerCase().includes("downgrade")) {
          invoiceType = "Downgrade";
        } else if (invoice.billing_reason === "subscription_create") {
          invoiceType = "New Subscription";
        } else if (invoice.billing_reason === "subscription_cycle") {
          invoiceType = "Subscription Renewal";
        } else if (invoice.billing_reason === "subscription_update") {
          invoiceType = "Subscription Update";
        }
      }

      return {
        id: invoice.id,
        number: invoice.number,
        date: invoice.created * 1000, // Convert to milliseconds
        amount: (invoice.total / 100).toFixed(2), // Convert cents to dollars
        currency: invoice.currency.toUpperCase(),
        status: invoice.status,
        invoicePdf: invoice.invoice_pdf,
        hostedInvoiceUrl: invoice.hosted_invoice_url,
        description: invoice.lines.data[0]?.description || "Subscription Payment",
        type: invoiceType,
        periodStart: invoice.period_start ? invoice.period_start * 1000 : null,
        periodEnd: invoice.period_end ? invoice.period_end * 1000 : null,
      };
    });

    // Filter by type if specified
    const filteredInvoices = typeFilter
      ? formattedInvoices.filter((invoice) => invoice.type === typeFilter)
      : formattedInvoices;

    // Slice to the requested limit after filtering
    const paginatedInvoices = filteredInvoices.slice(0, limit);

    return NextResponse.json({
      invoices: paginatedInvoices,
      hasMore: filteredInvoices.length > limit,
      nextCursor: paginatedInvoices.length > 0 && filteredInvoices.length > limit
        ? paginatedInvoices[paginatedInvoices.length - 1].id
        : null,
    });
  } catch (error) {
    console.error("Error fetching invoices:", error);
    return NextResponse.json(
      { error: "Failed to fetch invoices" },
      { status: 500 }
    );
  }
}
