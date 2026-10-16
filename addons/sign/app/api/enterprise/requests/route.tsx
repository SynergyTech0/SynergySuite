import { NextRequest } from "next/server";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { getServerSession } from "next-auth";
import { UserRole } from "@prisma/client";

export const dynamic = "force-dynamic";

const DEFAULT_LOOKBACK_DAYS = 30;

export async function GET(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);

    if (!session?.user?.id) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
      });
    }

    const user = await prisma.user.findUnique({
      where: { id: session.user.id },
      select: { role: true },
    });

    if (
      !user ||
      (user.role !== UserRole.ADMIN && user.role !== UserRole.CORPORATE)
    ) {
      return new Response(
        JSON.stringify({
          error: "Forbidden - Admin or Corporate access required",
        }),
        { status: 403 }
      );
    }

    const { searchParams } = new URL(request.url);
    const daysParam = searchParams.get("days");
    const companyNameFilter = searchParams.get("companyName");
    const statusFilter = searchParams.get("status");

    const activeEnterpriseEmails = await prisma.enterpriseAccount
      .findMany({
        select: { contactEmail: true },
        where: { isActive: true },
      })
      .then((accounts) => accounts.map((a) => a.contactEmail.toLowerCase()));

    const whereClause: any = {};

    // Build status filter
    if (statusFilter && statusFilter !== "ALL") {
      if (statusFilter === "APPROVED") {
        // For APPROVED status, only show requests that have active enterprise accounts
        whereClause.status = "APPROVED";
        if (activeEnterpriseEmails.length > 0) {
          whereClause.contactEmail = {
            in: activeEnterpriseEmails,
          };
        } else {
          // If no active enterprise accounts, return empty result for APPROVED filter
          whereClause.contactEmail = {
            in: [],
          };
        }
      } else {
        // For other statuses, just filter by status
        whereClause.status = statusFilter;
      }
    }
    // When statusFilter is "ALL" or not provided, show all requests (no status filter)

    // Add company name filter
    if (companyNameFilter && companyNameFilter.trim() !== "") {
      whereClause.companyName = {
        contains: companyNameFilter,
        mode: "insensitive",
      };
    }

    const requests = await prisma.enterpriseRequests.findMany({
      where: whereClause,
      select: {
        id: true,
        companyName: true,
        contactName: true,
        contactEmail: true,
        teamSize: true,
        message: true,
        status: true,
        createdAt: true,
        submitter: true,
      },
      orderBy: [{ status: "asc" }, { createdAt: "desc" }],
    });

    return new Response(JSON.stringify({ requests }), { status: 200 });
  } catch (error) {
    console.error("Error fetching enterprise requests:", error);
    return new Response(JSON.stringify({ error: "Internal Server Error" }), {
      status: 500,
    });
  }
}
