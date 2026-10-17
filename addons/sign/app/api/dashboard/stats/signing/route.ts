import { NextResponse } from "next/server";
import { getServerSession } from "@/lib/auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/db";

export async function GET() {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const userId = session.user.id;
    const userRole = session.user.role;

    if (userRole === 'SENDER' || userRole === 'ADMIN') {
      // Fetch stats for SENDER roles

      // Get document IDs and minimal info for analytics
      const documents = await prisma.document.findMany({
        where: { senderId: userId },
        select: { 
          id: true, 
          title: true, 
          createdAt: true, 
          completedAt: true, 
          deadline: true
        },
      });

      const documentIds = documents.map(doc => doc.id);

      // Get documents with signers for aggregation
      const documentsWithSigners = await prisma.document.findMany({
        where: { senderId: userId },
        select: {
          id: true,
          signers: {
            select: {
              status: true,
            }
          }
        }
      });

      // Aggregate signer statuses per document
      const signerStatusAggregation = documentsWithSigners.reduce((acc, doc) => {
        doc.signers.forEach(signer => {
          acc[doc.id] = acc[doc.id] || {};
          acc[doc.id][signer.status] = (acc[doc.id][signer.status] || 0) + 1;
          acc[doc.id]["total"] = (acc[doc.id]["total"] || 0) + 1;
        });
        return acc;
      }, {} as Record<string, Record<string, number>>);

      // Get document signers with only needed fields
      const documentSigners = await prisma.documentSigner.findMany({
        where: { documentId: { in: documentIds } },
        select: {
          status: true,
          email: true,
          name: true,
          signedAt: true,
          declinedAt: true,
          createdAt: true,
        }
      });

      // Aggregate stats
      const aggregatedStats = {
        totalDocuments: documentIds.length,
        pendingSignatures: documentSigners.filter(signer => signer.status === 'PENDING').length,
        completedDocuments: documentSigners.filter(signer => signer.status === 'COMPLETED').length,
        activeSigners: documentSigners.filter(signer => signer.status === 'PENDING').length,
      };

      return NextResponse.json({
        aggregatedStats,
        documentSigners,
        signerStatusAggregation,
        documents
      });
    }
} catch (error) {
    console.error("Error fetching dashboard stats:", error);
    return NextResponse.json(
      { error: "Internal Server Error" },
      { status: 500 }
    );
  }
}