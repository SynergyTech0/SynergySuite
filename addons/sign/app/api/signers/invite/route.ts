import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { NotificationType } from "@prisma/client";
import crypto from "crypto";
import { getServerSession } from "@/lib/auth";
import { authOptions } from "@/lib/auth";
import { createNotification } from "@/lib/notifications";
import { mailMode, sendEmail } from "@/lib/email";
import { renderSignatureRequest } from "@/lib/email-templates";
import { publicBase } from "@/lib/urls";

export async function POST(req: Request) {
  try {
    // ------------------------------------------------------------------
    // 1) AUTH  — this route had NONE. It accepted a documentId and a list of
    //    signers from anyone, and emailed each of them a tokenised /sign/<token>
    //    link. That let an unauthenticated caller inject themselves as a signer on
    //    a document they had nothing to do with and then READ AND SIGN it, and
    //    silently mutate its signingOrder. For an e-signature product, "only the
    //    intended parties can see and sign this" IS the product.
    //    Same pattern as /api/documents/upload: session, or a Bearer JWT.
    // ------------------------------------------------------------------
    let userId: string | null = null;
    const session = await getServerSession(authOptions);
    userId = (session?.user as any)?.id || null;


    if (!userId) {
      return NextResponse.json(
        { success: false, error: "Unauthorized" },
        { status: 401 }
      );
    }

    const { documentId, signers, signingOrder = "PARALLEL" } = await req.json();

    // Validate request body
    if (!documentId || !Array.isArray(signers) || signers.length === 0) {
      return NextResponse.json(
        { success: false, error: "Missing or invalid request data" },
        { status: 400 }
      );
    }

    // Get the document and update its signing order
    const document = await prisma.document.findUnique({
      where: { id: documentId },
      include: {
        sender: {
          select: {
            name: true,
            email: true,
          },
        },
      },
    });

    if (!document) {
      return NextResponse.json(
        { success: false, error: "Document not found" },
        { status: 404 }
      );
    }

    // 2) OWNERSHIP — authentication alone is not enough. Any logged-in user could
    //    otherwise invite signers to ANY document. You may only invite signers to a
    //    document you sent. (404, not 403: do not confirm the id exists to a stranger.)
    if (document.senderId !== userId) {
      return NextResponse.json(
        { success: false, error: "Document not found" },
        { status: 404 }
      );
    }

    // Update document with signing order
    await prisma.document.update({
      where: { id: documentId },
      data: { signingOrder: signingOrder as "PARALLEL" | "SEQUENTIAL" },
    });

    // No hard failure when mail isn't configured: sendEmail() keeps the message in ./dev-mail (lib/email).
    const mail = mailMode();
    if (mail.kind === "sink") console.warn(`[invite] ${mail.reason}: invitations go to ./dev-mail instead of being sent.`);

    let signerCount = 0;
    const createdSigners: any[] = [];

    // Loop through signers and create database records for all
    for (let i = 0; i < signers.length; i++) {
      const signer = signers[i];
      if (!signer.email) continue;

      // Generate a unique secure token for each signer
      const token = crypto.randomBytes(20).toString("hex");
      
      // Set token expiry (30 days from now)
      const tokenExpiresAt = new Date();
      tokenExpiresAt.setDate(tokenExpiresAt.getDate() + 30);

      // Check if this signer is already invited to this document
      const existingSigner = await prisma.documentSigner.findUnique({
        where: {
          documentId_email: {
            documentId,
            email: signer.email
          }
        }
      });

      if (existingSigner) {
        console.log(`Signer ${signer.email} already invited to document ${documentId}`);
        createdSigners.push({
          id: existingSigner.id,
          email: existingSigner.email,
          name: existingSigner.name,
        });
        continue; // Skip this signer and move to next
      }

      // Look for existing user with this email
      const existingUser = await prisma.user.findUnique({
        where: { email: signer.email },
        select: { id: true }
      });

      try {
        // Create signer entry in database with all required fields
        const documentSigner = await prisma.documentSigner.create({
          data: {
            documentId: documentId,
            userId: existingUser?.id, // Will be null if no user found
            name: signer.name || "",
            email: signer.email,
            token,
            tokenExpiresAt, // Set token expiry
            status: "PENDING",
            order: i + 1, // Set order based on position in array (1-indexed)
            createdAt: new Date(),
            updatedAt: new Date()
          },
          include: {
            user: {
              select: {
                id: true,
                email: true,
                name: true
              }
            }
          }
        });

        createdSigners.push({
          id: documentSigner.id,
          email: documentSigner.email,
          name: documentSigner.name,
        });

        // Send email invitation based on signing order
        const shouldSendEmail = signingOrder === "PARALLEL" || i === 0; // Send to all if parallel, only first if sequential

        if (shouldSendEmail) {
          const signLink = `${publicBase()}/sign/${token}`;
          console.log(`Sending email to ${signer.email} → ${signLink}`);

          // Generate professional email using template
          const emailHtml = renderSignatureRequest({
            signerName: signer.name || signer.email,
            documentTitle: document.title,
            senderName: document.sender?.name || undefined,
            signLink,
            isSequential: signingOrder === "SEQUENTIAL",
            isFirstSigner: i === 0,
            dueDate: document.deadline || undefined,
          });

          // Send the invite email
          const emailRes = await sendEmail(
            signer.email,
            `Signature Request – ${document.title}`,
            emailHtml,
          );

          if (!emailRes.success) {
            console.error(`Failed to send email to ${signer.email}:`, emailRes.messageId);
          } else {
            signerCount++;
            createNotification(
              signer.email,
              "Signature requested",
              "You have been invited to sign a document.",
              NotificationType.SIGNATURE_REQUESTED,
              existingUser?.id ?? undefined,
              documentId,
              signLink
            );
          }
        } else {
          console.log(`Skipping email for ${signer.email} (sequential signing, not first signer)`);
        }
      } catch (error: any) {
        // Handle unique constraint violation or other database errors
        if (error.code === 'P2002') {
          console.log(`Duplicate signer detected: ${signer.email} for document ${documentId}`);
          continue; // Skip this signer and move to next
        }
        throw error; // Re-throw other errors
      }
    }

    // Update document status to SENT
    await prisma.document.update({
      where: { id: documentId },
      data: { status: "SENT" },
    });

    return NextResponse.json({
      signersInvited: signerCount,
      signers: createdSigners,
      success: true });
  } catch (error: any) {
    console.error("Error sending invites:", error);
    return NextResponse.json(
      { success: false, error: error.message || "Failed to send invites" },
      { status: 500 }
    );
  }
}
