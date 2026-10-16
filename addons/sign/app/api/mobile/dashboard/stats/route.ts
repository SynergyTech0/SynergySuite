import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    // Extract and validate Bearer token
    const authHeader = request.headers.get("authorization");

    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return NextResponse.json(
        { error: "Missing or invalid authorization header" },
        { status: 401 }
      );
    }

    const token = authHeader.substring(7); // Remove "Bearer " prefix

    // Find session by token
    const session = await prisma.session.findUnique({
      where: { sessionToken: token },
      include: {
        user: true
      }
    });

    if (!session) {
      return NextResponse.json(
        { error: "Invalid or expired session" },
        { status: 401 }
      );
    }

    // Check if session is expired
    if (session.expires < new Date()) {
      // Clean up expired session
      await prisma.session.delete({
        where: { sessionToken: token }
      });

      return NextResponse.json(
        { error: "Session expired" },
        { status: 401 }
      );
    }

    const user = session.user;
    const userId = user.id;
    const userRole = user.role;

    let stats: any = {};

    if (userRole === 'ADMIN') {
      // Admin sees all system stats
      const [totalDocuments, pendingSignatures, completedDocuments, activeSigners] = await Promise.all([
        prisma.document.count(),
        prisma.document.count({
          where: { status: 'SENT' }
        }),
        prisma.document.count({
          where: { status: 'COMPLETED' }
        }),
        prisma.documentSigner.count({
          where: { status: 'PENDING' }
        })
      ]);

      stats = {
        totalDocuments,
        pendingSignatures,
        completedDocuments,
        activeSigners
      };

    } else if (userRole === 'SENDER') {
      // Senders see their own document stats
      const [totalDocuments, pendingSignatures, completedDocuments, activeSigners] = await Promise.all([
        prisma.document.count({
          where: { senderId: userId }
        }),
        prisma.document.count({
          where: {
            senderId: userId,
            status: 'SENT'
          }
        }),
        prisma.document.count({
          where: {
            senderId: userId,
            status: 'COMPLETED'
          }
        }),
        prisma.documentSigner.count({
          where: {
            document: { senderId: userId },
            status: 'PENDING'
          }
        })
      ]);

      stats = {
        totalDocuments,
        pendingSignatures,
        completedDocuments,
        activeSigners
      };

    } else {
      // Signers see documents they need to sign
      const [documentsToSign, completedSignatures, pendingSignatures] = await Promise.all([
        prisma.documentSigner.count({
          where: {
            OR: [
              { userId: userId },
              { email: user.email }
            ]
          }
        }),
        prisma.documentSigner.count({
          where: {
            OR: [
              { userId: userId },
              { email: user.email }
            ],
            status: 'COMPLETED'
          }
        }),
        prisma.documentSigner.count({
          where: {
            OR: [
              { userId: userId },
              { email: user.email }
            ],
            status: 'PENDING'
          }
        })
      ]);

      stats = {
        totalDocuments: documentsToSign,
        pendingSignatures,
        completedDocuments: completedSignatures,
        activeSigners: 0
      };
    }

    return NextResponse.json(stats);

  } catch (error) {
    console.error("❌ Mobile dashboard stats error:", error);
    return NextResponse.json(
      { error: "Failed to fetch dashboard stats" },
      { status: 500 }
    );
  }
}
