import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { UserRole, EnterpriseStatus, NotificationType } from "@prisma/client";
import { createNotification } from "@/lib/notifications";
import { sendEmail } from "@/lib/email";
import {
  renderEnterpriseRequestApproved,
  renderEnterpriseRequestRejected,
} from "@/lib/email-templates";
import { generateInvitationToken } from "@/lib/invitation-tokens";
import crypto from "crypto";

export async function PATCH(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);

    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // ✅ Check if user has ADMIN or CORPORATE role
    const user = await prisma.user.findUnique({
      where: { id: session.user.id },
      select: { role: true },
    });

    if (!user || (user.role !== UserRole.ADMIN && user.role !== UserRole.CORPORATE)) {
      return NextResponse.json(
        { error: "Forbidden - Admin or Corporate access required" },
        { status: 403 }
      );
    }

    const { requestId, status } = await request.json();

    if (!requestId) {
      return NextResponse.json({ error: "Request ID is required" }, { status: 400 });
    }

    const validStatuses: EnterpriseStatus[] = [
      EnterpriseStatus.PENDING,
      EnterpriseStatus.DISCUSSION,
      EnterpriseStatus.APPROVED,
      EnterpriseStatus.REJECTED,
      EnterpriseStatus.ACTIVATED,
    ];

    if (!status || !validStatuses.includes(status)) {
      return NextResponse.json({ error: "Invalid status" }, { status: 400 });
    }

    // ✅ Check if request exists
    const existingRequest = await prisma.enterpriseRequests.findUnique({
      where: { id: requestId },
    });

    if (!existingRequest) {
      return NextResponse.json({ error: "Request not found" }, { status: 404 });
    }

    // ✅ Determine action text safely
    const statusActionMap: Record<EnterpriseStatus, string> = {
      PENDING: "MOVED TO PENDING",
      DISCUSSION: "MOVED TO DISCUSSION",
      APPROVED: "APPROVED",
      REJECTED: "REJECTED",
      ACTIVATED: "ACTIVATED",
    };

    const statusKey = status as EnterpriseStatus;
    const actionText = statusActionMap[statusKey] || "STATUS UPDATED";

    // ✅ Update status
    const updatedRequest = await prisma.enterpriseRequests.update({
      where: { id: requestId },
      data: {
        status: statusKey,
        updatedAt: new Date(),
      },
    });

    // ✅ Audit log entry
    await prisma.enterpriseAuditLog.create({
      data: {
        requestId,
        action: actionText,
        userId: session.user.id,
      },
    });

    // ✅ Send notification + email for APPROVED or REJECTED
    if (statusKey === EnterpriseStatus.APPROVED || statusKey === EnterpriseStatus.REJECTED) {
      const title =
        statusKey === EnterpriseStatus.APPROVED
          ? "Enterprise Request Approved"
          : "Enterprise Request Rejected";

      const message =
        statusKey === EnterpriseStatus.APPROVED
          ? "Your enterprise contact request has been approved. Welcome aboard!"
          : "We regret to inform you that your enterprise contact request has been rejected. If you have any questions, please contact support.";

      const notifType =
        (NotificationType as any).OTHER || NotificationType.REMINDER;

      await createNotification(
        existingRequest.contactEmail,
        title,
        message,
        notifType
      );

      try {
        let emailTemplate: string;
        const emailSubject = "Update on Your Enterprise Plan Request"; // Consistent subject for both

        if (statusKey === EnterpriseStatus.APPROVED) {
          const emailDomain = existingRequest.contactEmail.split("@")[1];
          let enterpriseAccount = await prisma.enterpriseAccount.findFirst({
            where: { domain: emailDomain },
          });

          if (!enterpriseAccount) {
            const teamSizeStr = existingRequest.teamSize.toString();
            const userLimit = parseInt(teamSizeStr) || 25;

            enterpriseAccount = await prisma.enterpriseAccount.create({
              data: {
                name: existingRequest.companyName,
                domain: emailDomain,
                contactEmail: existingRequest.contactEmail,
                contactName: existingRequest.contactName,
                userLimit: userLimit,
                isActive: true,
              },
            });
          }

          // Generate payment token for Stripe checkout
          const paymentToken = crypto.randomBytes(32).toString('hex');
          const paymentTokenExpiresAt = new Date();
          paymentTokenExpiresAt.setDate(paymentTokenExpiresAt.getDate() + 7); // 7 days expiry

          // Store payment token in database
          await prisma.enterpriseRequests.update({
            where: { id: requestId },
            data: {
              paymentToken,
              paymentTokenExpiresAt,
            },
          });

          // Create payment link URL
          const paymentUrl = `${process.env.NEXTAUTH_URL || "http://localhost:3000"}/enterprise/payment?token=${paymentToken}&requestId=${requestId}`;

          emailTemplate = renderEnterpriseRequestApproved({
            customerRequestId: existingRequest.customerRequestId || "N/A",
            contactName: existingRequest.contactName,
            companyName: existingRequest.companyName,
            teamSizeRange: existingRequest.teamSize,
            message: existingRequest.message || undefined,
            paymentUrl,
          });
        } else {
          emailTemplate = renderEnterpriseRequestRejected({
            customerRequestId: existingRequest.customerRequestId || "N/A",
            contactName: existingRequest.contactName,
            companyName: existingRequest.companyName,
            teamSizeRange: existingRequest.teamSize,
            message: existingRequest.message || undefined,
          });
        }

        const emailResult = await sendEmail(
          existingRequest.contactEmail,
          emailSubject,
          emailTemplate
        );
      } catch (emailError) {
        console.error(`Failed to send ${statusKey} email:`, emailError);
      }
    }

    return NextResponse.json({ success: true, request: updatedRequest });
  } catch (error) {
    console.error("Error updating enterprise request status:", error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
