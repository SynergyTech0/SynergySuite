import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "@/lib/auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const userId = session.user.id;
    const userRole = session.user.role;

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
              { email: session.user.email }
            ]
          }
        }),
        prisma.documentSigner.count({
          where: {
            OR: [
              { userId: userId },
              { email: session.user.email }
            ],
            status: 'COMPLETED'
          }
        }),
        prisma.documentSigner.count({
          where: {
            OR: [
              { userId: userId },
              { email: session.user.email }
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
    console.error("Dashboard stats error:", error);
    return NextResponse.json(
      { error: "Failed to fetch dashboard stats" },
      { status: 500 }
    );
  }
}

