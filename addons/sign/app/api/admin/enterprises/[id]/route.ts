import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/db";

export async function PUT(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await context.params;
    const session = await getServerSession(authOptions);

    if (!session || session.user.role !== "ADMIN") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json();
    const { 
      name, 
      domain, 
      contactName, 
      contactPhone, 
      userLimit, 
      contractStartDate, 
      contractEndDate, 
      notes, 
      customPricing, 
      isActive 
    } = body;

    const enterprise = await prisma.enterpriseAccount.update({
      where: { id },
      data: {
        ...(name !== undefined && { name }),
        ...(domain !== undefined && { domain }),
        ...(contactName !== undefined && { contactName }),
        ...(contactPhone !== undefined && { contactPhone }),
        ...(userLimit !== undefined && { userLimit: parseInt(String(userLimit)) }),
        ...(contractStartDate !== undefined && { 
          contractStartDate: contractStartDate ? new Date(contractStartDate) : null 
        }),
        ...(contractEndDate !== undefined && { 
          contractEndDate: contractEndDate ? new Date(contractEndDate) : null 
        }),
        ...(notes !== undefined && { notes }),
        ...(customPricing !== undefined && { customPricing: customPricing ? String(customPricing) : null }),
        ...(isActive !== undefined && { isActive }),
      },
    });

    return NextResponse.json(enterprise);
  } catch (error) {
    console.error("Error updating enterprise:", error);
    return NextResponse.json(
      { error: "Failed to update enterprise" },
      { status: 500 }
    );
  }
}

export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await context.params;
    const session = await getServerSession(authOptions);

    if (!session || session.user.role !== "ADMIN") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json();
    const { isActive, customPricing, notes } = body;

    const enterprise = await prisma.enterpriseAccount.update({
      where: { id },
      data: {
        ...(isActive !== undefined && { isActive }),
        ...(customPricing !== undefined && { customPricing: String(customPricing) }),
        ...(notes !== undefined && { notes }),
      },
    });

    return NextResponse.json(enterprise);
  } catch (error) {
    console.error("Error updating enterprise:", error);
    return NextResponse.json(
      { error: "Failed to update enterprise" },
      { status: 500 }
    );
  }
}

export async function DELETE(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await context.params;
    const session = await getServerSession(authOptions);

    if (!session || session.user.role !== "ADMIN") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const enterprise = await prisma.enterpriseAccount.findUnique({
      where: { id },
      select: { contactEmail: true },
    });

    await prisma.user.updateMany({
      where: { enterpriseId: id },
      data: { enterpriseId: null },
    });

    await prisma.enterpriseAccount.delete({
      where: { id },
    });

    if (enterprise) {
      await prisma.enterpriseRequests.updateMany({
        where: {
          contactEmail: enterprise.contactEmail.toLowerCase(),
          status: 'APPROVED',
        },
        data: {
          status: 'REJECTED',
          updatedAt: new Date(),
        },
      });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error deleting enterprise:", error);
    return NextResponse.json(
      { error: "Failed to delete enterprise" },
      { status: 500 }
    );
  }
}